import { EventEmitter } from 'events'
import { basename, isAbsolute, relative, resolve, normalize } from 'path'
import type { DatabaseService } from './database-service'
import type { NormalizedEvent, AssistantMessagePayload } from '../../shared/types'
import type { ContextMemory, ContextSessionSummary } from './types'
import { extractFilePatterns, extractErrorPatterns, extractToolPreferences } from './memory-extractors'
import { extractDecisions, extractPitfalls, buildCooccurrenceMap } from './smart-extractors'

// ── Per-tab ingestion state ─────────────────────────────────────────────

interface TabIngestionState {
  sessionId: string | null
  projectId: string | null
  projectRoot: string | null
  textBuffer: string[]
  textFlushTimer: ReturnType<typeof setTimeout> | null
  eventSeqCounter: number
  messageSeqCounter: number
  currentToolCall: { toolName: string; toolId: string; partialInput: string } | null
}

// ── Tool → action mapping ───────────────────────────────────────────────

const TOOL_ACTION_MAP: Record<string, string> = {
  Read: 'read',
  Edit: 'patch',
  Write: 'write',
  MultiEdit: 'patch',
}

const BASH_DELETE_PATTERNS = [/\brm\b/, /\bdel\b/, /\brmdir\b/, /\bRemove-Item\b/]

const TEXT_FLUSH_TIMEOUT_MS = 5_000
/** Maximum text buffer entries before forcing a flush (prevents unbounded growth). */
const MAX_TEXT_BUFFER_ENTRIES = 500

// ── Degraded mode ───────────────────────────────────────────────────────

const DEGRADED_COOLDOWN_MS = 30_000
const DEGRADED_THRESHOLD = 3

/**
 * IngestionService listens to ControlPlane events and persists structured data
 * to the context database via DatabaseService.
 *
 * It never throws into the caller — all errors are caught and logged.
 * If the database fails repeatedly, it enters a degraded mode where it
 * stops attempting writes for 30 seconds before retrying.
 *
 * Events emitted:
 *  - 'memory-created' (ContextMemory)
 *  - 'session-recorded' (ContextSessionSummary)
 */
export class IngestionService extends EventEmitter {
  private db: DatabaseService
  private tabStates = new Map<string, TabIngestionState>()

  // Degraded mode tracking
  private consecutiveErrors = 0
  private degradedUntil = 0

  constructor(db: DatabaseService) {
    super()
    this.db = db
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Route a NormalizedEvent to the appropriate handler.
   * Never throws — all errors are caught internally.
   */
  ingest(tabId: string, event: NormalizedEvent): void {
    try {
      if (this.isDegraded()) return

      switch (event.type) {
        case 'session_init':
          this.handleSessionInit(tabId, event)
          break
        case 'text_chunk':
          this.handleTextChunk(tabId, event)
          break
        case 'tool_call':
          this.handleToolCall(tabId, event)
          break
        case 'tool_call_update':
          this.handleToolCallUpdate(tabId, event)
          break
        case 'tool_call_complete':
          this.handleToolCallComplete(tabId, event)
          break
        case 'task_update':
          this.handleTaskUpdate(tabId, event)
          break
        case 'task_complete':
          this.handleTaskComplete(tabId, event)
          break
        case 'error':
          this.handleError(tabId, event)
          break
        case 'session_dead':
          this.handleSessionDead(tabId, event)
          break
        case 'permission_request':
          this.handlePermissionRequest(tabId, event)
          break
        case 'rate_limit':
          this.handleRateLimit(tabId, event)
          break
        case 'usage':
          this.handleUsage(tabId, event)
          break
      }

      this.consecutiveErrors = 0
    } catch (err) {
      this.handleIngestionError(err)
    }
  }

  /**
   * Capture a user prompt before it goes to RunManager.
   * Creates a message record with role='user'.
   */
  ingestUserMessage(tabId: string, _requestId: string, prompt: string, _attachments: unknown[]): void {
    try {
      if (this.isDegraded()) return

      // ensureSession in case initTab wasn't called yet (e.g. resumed tab)
      const state = this.ensureSession(tabId)
      if (!state?.sessionId) return

      state.messageSeqCounter++
      this.db.insertMessage(state.sessionId, 'user', prompt, state.messageSeqCounter)

      this.consecutiveErrors = 0
    } catch (err) {
      this.handleIngestionError(err)
    }
  }

  /**
   * Handle tab status transitions from ControlPlane.
   * Used to detect session lifecycle changes.
   */
  onTabStatusChange(tabId: string, newStatus: string, _oldStatus: string): void {
    try {
      if (this.isDegraded()) return

      const state = this.tabStates.get(tabId)
      if (!state?.sessionId) return

      // Status transitions handled by specific event handlers
      // (task_complete → completed, session_dead → dead)
      // This hook is available for future transitions if needed.

      // If tab goes to 'dead' status but we didn't get a session_dead event,
      // update the session anyway.
      if (newStatus === 'dead') {
        const row = this.db.db
          .prepare('SELECT status FROM sessions WHERE id = ?')
          .get(state.sessionId) as { status: string } | undefined

        if (row && row.status === 'active') {
          this.db.updateSession(state.sessionId, {
            status: 'dead',
            ended_at: new Date().toISOString(),
          })
          this.flushTextBuffer(tabId)
        }
      }

      this.consecutiveErrors = 0
    } catch (err) {
      this.handleIngestionError(err)
    }
  }

  /**
   * Called when a tab is closed. Final flush + set abandoned if needed.
   */
  onTabClosed(tabId: string): void {
    try {
      if (this.isDegraded()) return

      const state = this.tabStates.get(tabId)
      if (!state) return

      // Flush pending text
      this.flushTextBuffer(tabId)

      // Clear the flush timer
      if (state.textFlushTimer) {
        clearTimeout(state.textFlushTimer)
        state.textFlushTimer = null
      }

      // If session exists and is still active, mark as abandoned
      if (state.sessionId) {
        const row = this.db.db
          .prepare('SELECT status FROM sessions WHERE id = ?')
          .get(state.sessionId) as { status: string } | undefined

        if (row && row.status === 'active') {
          this.db.updateSession(state.sessionId, {
            status: 'abandoned',
            ended_at: new Date().toISOString(),
          })
        }
      }

      // Clean up state
      this.tabStates.delete(tabId)

      this.consecutiveErrors = 0
    } catch (err) {
      this.handleIngestionError(err)
    }
  }

  /**
   * Clean up all timers on shutdown.
   */
  shutdown(): void {
    for (const [tabId, state] of this.tabStates) {
      if (state.textFlushTimer) {
        clearTimeout(state.textFlushTimer)
        state.textFlushTimer = null
      }
      try {
        this.flushTextBuffer(tabId)
      } catch {
        // ignore on shutdown
      }
    }
    this.tabStates.clear()
  }

  // ── Event Handlers ──────────────────────────────────────────────────

  private handleSessionInit(
    tabId: string,
    event: Extract<NormalizedEvent, { type: 'session_init' }>,
  ): void {
    // Skip warmup inits
    if (event.isWarmup) return

    let state = this.tabStates.get(tabId)

    // Resolve project from cwd (we get it from the tab's workingDirectory).
    // session_init doesn't carry cwd directly in the NormalizedEvent, so we
    // need to extract it. We'll use the project root if already known, or
    // defer to when it's provided.
    // Note: The raw InitEvent has cwd but the NormalizedEvent doesn't include it.
    // For now, project creation happens on first user message or when
    // workingDirectory is provided externally.

    // If we already have state for this tab, update it
    if (state?.sessionId) {
      // Session already exists — update with new data
      this.db.updateSession(state.sessionId, {
        claude_session_id: event.sessionId,
      })
      return
    }

    // Lazy session creation — we don't have a project yet.
    // Store session_init data for when we can create the session.
    if (!state) {
      state = this.createTabState()
      this.tabStates.set(tabId, state)
    }

    // Store init data — we'll create the session when projectId is available.
    // In practice, we call ensureSession when any persist-needing event arrives.
    state.currentToolCall = null
  }

  /**
   * Ensure a session exists for this tab.
   * Creates project + session lazily on first need.
   */
  ensureSession(tabId: string, cwd?: string): TabIngestionState | null {
    let state = this.tabStates.get(tabId)

    if (state?.sessionId) return state

    if (!state) {
      state = this.createTabState()
      this.tabStates.set(tabId, state)
    }

    if (!cwd && !state.projectRoot) return null

    const projectRoot = cwd || state.projectRoot
    if (!projectRoot) return null

    state.projectRoot = projectRoot

    // Create/resolve project
    const projectName = basename(projectRoot) || projectRoot
    state.projectId = this.db.upsertProject(projectRoot, projectName)

    // Create session
    state.sessionId = this.db.createSession(state.projectId)

    return state
  }

  /**
   * Initialize tab state with a working directory.
   * Called externally to provide the cwd that session_init doesn't carry
   * in the NormalizedEvent.
   */
  initTab(tabId: string, workingDirectory: string): void {
    try {
      if (this.isDegraded()) return

      let state = this.tabStates.get(tabId)
      if (!state) {
        state = this.createTabState()
        this.tabStates.set(tabId, state)
      }

      state.projectRoot = workingDirectory

      // Eagerly create the session so subsequent events can persist
      this.ensureSession(tabId, workingDirectory)

      this.consecutiveErrors = 0
    } catch (err) {
      this.handleIngestionError(err)
    }
  }

  private handleTextChunk(
    tabId: string,
    event: Extract<NormalizedEvent, { type: 'text_chunk' }>,
  ): void {
    let state = this.tabStates.get(tabId)
    if (!state) {
      state = this.createTabState()
      this.tabStates.set(tabId, state)
    }

    state.textBuffer.push(event.text)

    // Force-flush if buffer is getting large (prevents unbounded growth)
    if (state.textBuffer.length >= MAX_TEXT_BUFFER_ENTRIES) {
      if (state.textFlushTimer) {
        clearTimeout(state.textFlushTimer)
        state.textFlushTimer = null
      }
      this.flushTextBuffer(tabId)
      return
    }

    // Reset the flush timer
    if (state.textFlushTimer) {
      clearTimeout(state.textFlushTimer)
    }

    state.textFlushTimer = setTimeout(() => {
      try {
        this.flushTextBuffer(tabId)
      } catch (err) {
        this.handleIngestionError(err)
      }
    }, TEXT_FLUSH_TIMEOUT_MS)
  }

  private handleToolCall(
    tabId: string,
    event: Extract<NormalizedEvent, { type: 'tool_call' }>,
  ): void {
    const state = this.ensureSession(tabId) ?? this.getOrCreateState(tabId)
    if (!state.sessionId) return

    // Flush any pending text before processing tool call
    this.flushTextBuffer(tabId)

    // Store current tool call for accumulating partial input
    state.currentToolCall = {
      toolName: event.toolName,
      toolId: event.toolId,
      partialInput: '',
    }

    // Persist the tool_call event
    state.eventSeqCounter++
    const eventId = this.db.insertEvent(
      state.sessionId,
      'tool_call',
      JSON.stringify({
        toolName: event.toolName,
        toolId: event.toolId,
        index: event.index,
      }),
      state.eventSeqCounter,
    )

    // Extract file path for file-touching tools
    this.extractFileTouched(state, event.toolName, eventId, undefined)
  }

  private handleToolCallUpdate(
    tabId: string,
    event: Extract<NormalizedEvent, { type: 'tool_call_update' }>,
  ): void {
    const state = this.tabStates.get(tabId)
    if (!state?.currentToolCall) return

    // Accumulate partial input
    state.currentToolCall.partialInput += event.partialInput
  }

  private handleToolCallComplete(
    tabId: string,
    event: Extract<NormalizedEvent, { type: 'tool_call_complete' }>,
  ): void {
    const state = this.tabStates.get(tabId)
    if (!state?.sessionId) return

    state.eventSeqCounter++
    const eventId = this.db.insertEvent(
      state.sessionId,
      'tool_call_complete',
      JSON.stringify({
        index: event.index,
        toolName: state.currentToolCall?.toolName,
        toolId: state.currentToolCall?.toolId,
        input: state.currentToolCall?.partialInput,
      }),
      state.eventSeqCounter,
    )

    // Extract file path from accumulated partial input
    if (state.currentToolCall) {
      let parsedInput: Record<string, unknown> | null = null
      try {
        parsedInput = JSON.parse(state.currentToolCall.partialInput)
      } catch {
        // partial input may not be valid JSON — that's fine
      }

      this.extractFileTouched(
        state,
        state.currentToolCall.toolName,
        eventId,
        parsedInput ?? undefined,
      )
    }

    // Clear current tool call
    state.currentToolCall = null
  }

  private handleTaskUpdate(
    tabId: string,
    event: Extract<NormalizedEvent, { type: 'task_update' }>,
  ): void {
    const state = this.ensureSession(tabId) ?? this.getOrCreateState(tabId)
    if (!state.sessionId) return

    // Flush pending text as assistant message
    this.flushTextBuffer(tabId)

    // Persist the task_update event
    state.eventSeqCounter++
    this.db.insertEvent(
      state.sessionId,
      'task_update',
      JSON.stringify({ messageId: event.message.id }),
      state.eventSeqCounter,
    )

    // Persist the assistant message content
    const textContent = this.extractTextFromMessage(event.message)
    if (textContent) {
      state.messageSeqCounter++
      this.db.insertMessage(
        state.sessionId,
        'assistant',
        textContent,
        state.messageSeqCounter,
      )
    }
  }

  private handleTaskComplete(
    tabId: string,
    event: Extract<NormalizedEvent, { type: 'task_complete' }>,
  ): void {
    const state = this.tabStates.get(tabId)
    if (!state?.sessionId) return

    // Flush pending text
    this.flushTextBuffer(tabId)

    // Persist task_complete event
    state.eventSeqCounter++
    this.db.insertEvent(
      state.sessionId,
      'task_complete',
      JSON.stringify({
        result: event.result,
        costUsd: event.costUsd,
        durationMs: event.durationMs,
        numTurns: event.numTurns,
        sessionId: event.sessionId,
      }),
      state.eventSeqCounter,
    )

    // Update session status
    this.db.updateSession(state.sessionId, {
      status: 'completed',
      ended_at: new Date().toISOString(),
    })

    // Generate mechanical session summary
    const summary = this.generateMechanicalSummary(state.sessionId)
    if (summary) {
      this.db.upsertSessionSummary(state.sessionId, 'technical', summary)
    }

    // Create session_outcome memory
    this.createSessionOutcomeMemory(state, event)

    // Run memory extractors
    if (state.projectId && state.sessionId) {
      try {
        extractFilePatterns(this.db, state.projectId, state.sessionId)
        extractErrorPatterns(this.db, state.projectId, state.sessionId)
        extractToolPreferences(this.db, state.projectId, state.sessionId)
        // Smart context extractors
        extractDecisions(this.db, state.projectId, state.sessionId)
        extractPitfalls(this.db, state.projectId, state.sessionId)
        buildCooccurrenceMap(this.db, state.projectId, state.sessionId)
      } catch (err) {
        console.error('[IngestionService] Memory extractor error:', err)
      }
    }

    // Emit events
    const sessionDetail = this.db.getSessionDetail(state.sessionId)
    if (sessionDetail) {
      this.emit('session-recorded', sessionDetail as ContextSessionSummary)
    }
  }

  private handleError(
    tabId: string,
    event: Extract<NormalizedEvent, { type: 'error' }>,
  ): void {
    const state = this.tabStates.get(tabId)
    if (!state?.sessionId) return

    state.eventSeqCounter++
    this.db.insertEvent(
      state.sessionId,
      'error',
      JSON.stringify({
        message: event.message,
        isError: event.isError,
        sessionId: event.sessionId,
      }),
      state.eventSeqCounter,
    )
  }

  private handleSessionDead(
    tabId: string,
    event: Extract<NormalizedEvent, { type: 'session_dead' }>,
  ): void {
    const state = this.tabStates.get(tabId)
    if (!state?.sessionId) return

    // Flush pending text
    this.flushTextBuffer(tabId)

    state.eventSeqCounter++
    this.db.insertEvent(
      state.sessionId,
      'session_dead',
      JSON.stringify({
        exitCode: event.exitCode,
        signal: event.signal,
        stderrTail: event.stderrTail,
      }),
      state.eventSeqCounter,
    )

    this.db.updateSession(state.sessionId, {
      status: 'dead',
      ended_at: new Date().toISOString(),
    })
  }

  private handlePermissionRequest(
    tabId: string,
    event: Extract<NormalizedEvent, { type: 'permission_request' }>,
  ): void {
    const state = this.tabStates.get(tabId)
    if (!state?.sessionId) return

    state.eventSeqCounter++
    this.db.insertEvent(
      state.sessionId,
      'permission_request',
      JSON.stringify({
        questionId: event.questionId,
        toolName: event.toolName,
        toolDescription: event.toolDescription,
        options: event.options,
      }),
      state.eventSeqCounter,
    )
  }

  private handleRateLimit(
    tabId: string,
    event: Extract<NormalizedEvent, { type: 'rate_limit' }>,
  ): void {
    const state = this.tabStates.get(tabId)
    if (!state?.sessionId) return

    state.eventSeqCounter++
    this.db.insertEvent(
      state.sessionId,
      'rate_limit',
      JSON.stringify({
        status: event.status,
        resetsAt: event.resetsAt,
        rateLimitType: event.rateLimitType,
      }),
      state.eventSeqCounter,
    )
  }

  private handleUsage(
    tabId: string,
    event: Extract<NormalizedEvent, { type: 'usage' }>,
  ): void {
    const state = this.tabStates.get(tabId)
    if (!state?.sessionId) return

    state.eventSeqCounter++
    this.db.insertEvent(
      state.sessionId,
      'usage',
      JSON.stringify({ usage: event.usage }),
      state.eventSeqCounter,
    )
  }

  // ── Text Buffer Management ──────────────────────────────────────────

  private flushTextBuffer(tabId: string): void {
    const state = this.tabStates.get(tabId)
    if (!state || state.textBuffer.length === 0) return
    if (!state.sessionId) {
      // Can't persist without a session — clear the buffer anyway
      state.textBuffer = []
      return
    }

    const text = state.textBuffer.join('')
    state.textBuffer = []

    if (state.textFlushTimer) {
      clearTimeout(state.textFlushTimer)
      state.textFlushTimer = null
    }

    if (text.trim().length === 0) return

    state.messageSeqCounter++
    this.db.insertMessage(state.sessionId, 'assistant', text, state.messageSeqCounter)
  }

  // ── File Touched Extraction ─────────────────────────────────────────

  private extractFileTouched(
    state: TabIngestionState,
    toolName: string,
    eventId: string,
    parsedInput?: Record<string, unknown>,
  ): void {
    if (!state.sessionId) return

    const action = TOOL_ACTION_MAP[toolName]

    if (action && parsedInput) {
      const filePath = (parsedInput.file_path || parsedInput.path) as string | undefined
      if (filePath) {
        const normalizedPath = this.normalizeFilePath(filePath, state.projectRoot)
        this.db.insertFileTouched(state.sessionId, eventId, normalizedPath, action)
      }
      return
    }

    // Bash — check for delete commands
    if (toolName === 'Bash' && parsedInput) {
      const command = (parsedInput.command || parsedInput.cmd || '') as string
      const isDelete = BASH_DELETE_PATTERNS.some((p) => p.test(command))
      if (isDelete) {
        // Best-effort: try to extract a path-like token after the command
        const tokens = command.split(/\s+/)
        const pathToken = tokens.find((t) =>
          t.includes('/') || t.includes('\\') || t.includes('.'),
        )
        if (pathToken) {
          const normalizedPath = this.normalizeFilePath(pathToken, state.projectRoot)
          this.db.insertFileTouched(state.sessionId, eventId, normalizedPath, 'delete')
        }
      }
    }
  }

  private normalizeFilePath(filePath: string, projectRoot: string | null): string {
    if (!projectRoot) return filePath

    // Normalize the path
    let normalized = normalize(filePath)

    // If absolute, make relative to project root
    if (isAbsolute(normalized)) {
      const resolvedRoot = resolve(projectRoot)
      normalized = relative(resolvedRoot, normalized)
    }

    // Normalize separators to forward slashes
    normalized = normalized.replace(/\\/g, '/')

    return normalized
  }

  // ── Summary Generation ──────────────────────────────────────────────

  private generateMechanicalSummary(sessionId: string): string | null {
    const detail = this.db.getSessionDetail(sessionId)
    if (!detail) return null

    const filesTouchedStr =
      detail.filesTouched.length > 0
        ? detail.filesTouched
            .map((f) => `${f.actions.join('/')} ${f.path}`)
            .join(', ')
        : 'none'

    // Get unique tool names from events
    const toolEvents = this.db.db
      .prepare(
        `SELECT DISTINCT json_extract(payload_json, '$.toolName') as tool_name
         FROM events
         WHERE session_id = ? AND event_type = 'tool_call' AND deleted_at IS NULL
         AND json_extract(payload_json, '$.toolName') IS NOT NULL`,
      )
      .all(sessionId) as Array<{ tool_name: string }>
    const uniqueTools = toolEvents.map((e) => e.tool_name).filter(Boolean)

    // Count errors
    const errorRow = this.db.db
      .prepare(
        `SELECT COUNT(*) as count FROM events
         WHERE session_id = ? AND event_type = 'error' AND deleted_at IS NULL`,
      )
      .get(sessionId) as { count: number }

    // Include user prompts and assistant response snippets for context
    const messages = this.db.db
      .prepare(
        `SELECT role, substr(content, 1, 300) as content FROM messages
         WHERE session_id = ? AND deleted_at IS NULL
         ORDER BY seq_num LIMIT 20`,
      )
      .all(sessionId) as Array<{ role: string; content: string }>

    const conversationLines: string[] = []
    for (const msg of messages) {
      if (!msg.content) continue
      const prefix = msg.role === 'user' ? 'User' : 'Assistant'
      const snippet = msg.content.length >= 300
        ? msg.content.substring(0, 297) + '...'
        : msg.content
      conversationLines.push(`${prefix}: ${snippet}`)
    }

    const parts = [
      `Goal: ${detail.goal || detail.title || 'N/A'}`,
      `Files touched: ${filesTouchedStr}`,
      `Tools used: ${uniqueTools.length > 0 ? uniqueTools.join(', ') : 'none'}`,
      `Errors: ${errorRow.count}`,
      `Status: ${detail.status}`,
    ]

    if (conversationLines.length > 0) {
      parts.push('', 'Conversation:', ...conversationLines)
    }

    return parts.join('\n')
  }

  // ── Memory Creation ─────────────────────────────────────────────────

  private createSessionOutcomeMemory(
    state: TabIngestionState,
    event: Extract<NormalizedEvent, { type: 'task_complete' }>,
  ): void {
    if (!state.projectId || !state.sessionId) return

    const detail = this.db.getSessionDetail(state.sessionId)
    if (!detail) return

    const importance = this.computeSessionImportance(detail, event)

    const title = detail.goal || detail.title || 'Session completed'
    const body = this.generateMechanicalSummary(state.sessionId)

    const memoryId = this.db.insertMemory({
      projectId: state.projectId,
      sessionId: state.sessionId,
      memoryType: 'session_outcome',
      scope: 'project',
      title,
      body,
      sourceRefsJson: null,
      importanceScore: importance,
      confidenceScore: 1.0,
    })

    // Emit memory-created event
    const memory: ContextMemory = {
      id: memoryId,
      memoryType: 'session_outcome',
      scope: 'project',
      title,
      body,
      importanceScore: importance,
      confidenceScore: 1.0,
      isPinned: false,
      accessCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.emit('memory-created', memory)
  }

  private computeSessionImportance(
    detail: { status: string; filesTouched: Array<{ path: string }>; durationMs: number | null },
    _event: Extract<NormalizedEvent, { type: 'task_complete' }>,
  ): number {
    let score = 0.5

    if (detail.status === 'completed') score += 0.1
    if (detail.status === 'dead') score -= 0.1

    const fileCount = detail.filesTouched.length
    if (fileCount >= 5) score += 0.15
    else if (fileCount >= 2) score += 0.05

    // Check for errors in this session
    // (simplified — we count error events)
    // Error + completed = recovery = interesting
    // Already handled by detail.status check above

    if (detail.durationMs && detail.durationMs > 120_000) score += 0.05

    return Math.max(0.0, Math.min(1.0, score))
  }

  // ── Helper Utilities ────────────────────────────────────────────────

  private extractTextFromMessage(message: AssistantMessagePayload): string {
    if (!message?.content) return ''

    return message.content
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text!)
      .join('')
  }

  private createTabState(): TabIngestionState {
    return {
      sessionId: null,
      projectId: null,
      projectRoot: null,
      textBuffer: [],
      textFlushTimer: null,
      eventSeqCounter: 0,
      messageSeqCounter: 0,
      currentToolCall: null,
    }
  }

  private getOrCreateState(tabId: string): TabIngestionState {
    let state = this.tabStates.get(tabId)
    if (!state) {
      state = this.createTabState()
      this.tabStates.set(tabId, state)
    }
    return state
  }

  // ── Degraded Mode ───────────────────────────────────────────────────

  private isDegraded(): boolean {
    if (this.degradedUntil === 0) return false
    if (Date.now() >= this.degradedUntil) {
      // Cooldown expired — reset
      this.degradedUntil = 0
      this.consecutiveErrors = 0
      return false
    }
    return true
  }

  private handleIngestionError(err: unknown): void {
    this.consecutiveErrors++
    console.error('[IngestionService] Ingestion error:', err)

    if (this.consecutiveErrors >= DEGRADED_THRESHOLD) {
      this.degradedUntil = Date.now() + DEGRADED_COOLDOWN_MS
      console.warn(
        `[IngestionService] Entering degraded mode for ${DEGRADED_COOLDOWN_MS / 1000}s after ${this.consecutiveErrors} consecutive errors`,
      )
    }
  }

  // ── Test helpers ────────────────────────────────────────────────────

  /** @internal — exposed for testing only */
  _getTabState(tabId: string): TabIngestionState | undefined {
    return this.tabStates.get(tabId)
  }

  /** @internal — exposed for testing only */
  _getDegradedUntil(): number {
    return this.degradedUntil
  }

  /** @internal — exposed for testing only */
  _setDegradedUntil(value: number): void {
    this.degradedUntil = value
  }

  /** @internal — exposed for testing only */
  _setConsecutiveErrors(value: number): void {
    this.consecutiveErrors = value
  }
}
