import { EventEmitter } from 'events'
import { RunManager } from './run-manager'
import { PtyRunManager } from './pty-run-manager'
import { PermissionServer, maskSensitiveFields } from '../hooks/permission-server'
import { AgentMemory } from '../agent-memory'
import type { SessionDigestManager } from './session-digest'
import type { CompanionNarrator } from './companion-narrator'
import type { RetrievalService } from '../context/retrieval-service'
import { BudgetEnforcer } from '../budget-enforcer'
import type { HookToolRequest, PermissionOption } from '../hooks/permission-server'
import { WorktreeManager } from '../sandbox/worktree-manager'
import { GitDiffEngine } from '../sandbox/git-diff-engine'
import { DirtyDetector } from '../sandbox/dirty-detector'
import type { WorktreeInfo } from '../../shared/sandbox-types'
import { log as _log } from '../logger'
import type {
  TabStatus,
  TabRegistryEntry,
  HealthReport,
  NormalizedEvent,
  RunOptions,
  EnrichedError,
  AgentMemorySnapshot,
  AgentMemoryClaimResult,
} from '../../shared/types'

const MAX_QUEUE_DEPTH = 32

function log(msg: string): void {
  _log('ControlPlane', msg)
}

interface QueuedRequest {
  requestId: string
  tabId: string
  options: RunOptions
  resolve: (value: void) => void
  reject: (reason: Error) => void
  enqueuedAt: number
  /** Additional waiters that called submitPrompt with the same requestId */
  extraWaiters: Array<{ resolve: (value: void) => void; reject: (reason: Error) => void }>
}

interface InflightRequest {
  requestId: string
  tabId: string
  promise: Promise<void>
  resolve: (value: void) => void
  reject: (reason: Error) => void
}

/**
 * ControlPlane: the single backend authority for tab/session lifecycle.
 *
 * Responsibilities:
 *  1. Tab/session registry
 *  2. Request queue + backpressure
 *  3. RequestId idempotency
 *  4. Target session guard
 *  5. Run lifecycle state transitions
 *  6. Health reporting for renderer reconciliation
 *  7. Diagnostic data (delegated to RunManager ring buffers)
 *
 * Events emitted (forwarded from RunManager, tagged with tabId):
 *  - 'event' (tabId, NormalizedEvent)
 *  - 'tab-status-change' (tabId, newStatus, oldStatus)
 *  - 'error' (tabId, EnrichedError)
 */
export class ControlPlane extends EventEmitter {
  private tabs = new Map<string, TabRegistryEntry>()
  private inflightRequests = new Map<string, InflightRequest>()
  private requestQueue: QueuedRequest[] = []
  private runManager: RunManager
  private ptyRunManager: PtyRunManager
  /** Feature flag: use PTY transport for interactive permissions */
  private interactivePty: boolean
  /** Tracks which runs are using PTY transport (by requestId) */
  private ptyRuns = new Set<string>()
  /** Tracks requestIds that are warmup init requests (invisible to renderer) */
  private initRequestIds = new Set<string>()
  /** Permission hook server for PreToolUse HTTP hooks */
  private permissionServer: PermissionServer
  /** Per-run tokens: requestId → runToken (for cleanup on exit/error) */
  private runTokens = new Map<string, string>()
  /** Global permission mode: 'ask' shows cards, 'auto' auto-approves */
  private permissionMode: 'ask' | 'auto' = 'ask'
  /** Resolves when the permission server is ready (or failed). Dispatch awaits this. */
  private hookServerReady: Promise<void>
  /** Optional persisted coordination memory shared across tabs/agents. */
  private agentMemory: AgentMemory | null = null
  /** Optional session digest manager for cross-session context. */
  private digestManager: SessionDigestManager | null = null
  /** Optional companion narrator for idle-time commentary. */
  private companionNarrator: CompanionNarrator | null = null
  /** Optional context database retrieval service for memory packet injection. */
  private retrievalService: RetrievalService | null = null
  /** Optional budget enforcer for per-tab spending limits. */
  budgetEnforcer: BudgetEnforcer | null = null
  /** Sandbox worktree manager for isolated runs. */
  private worktreeManager = new WorktreeManager()
  /** Sandbox diff engine for post-run diff generation. */
  private gitDiffEngine = new GitDiffEngine()
  /** Sandbox dirty detector for pre-run working directory checks. */
  private dirtyDetector = new DirtyDetector()
  /** Stored listener references for clean individual removal on shutdown */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _wiredListeners: Array<{ emitter: EventEmitter; event: string; listener: (...args: any[]) => void }> = []
  /** Prevents double-wiring if constructor is somehow called again */
  private _eventsWired = false

  constructor(interactivePty = false) {
    super()
    this.interactivePty = interactivePty
    this.runManager = new RunManager()
    this.ptyRunManager = new PtyRunManager()
    this.permissionServer = new PermissionServer()

    // Start the permission hook server. _dispatch awaits hookServerReady
    // so early prompts don't silently fall back to the --allowedTools path.
    this.hookServerReady = this.permissionServer.start()
      .then((port) => {
        log(`Permission hook server ready on port ${port}`)
      })
      .catch((err) => {
        log(`Failed to start permission hook server: ${(err as Error).message}`)
        // No hook server → dispatch falls back to --allowedTools
      })

    // Guard against double-wiring
    if (this._eventsWired) return
    this._eventsWired = true

    // Wire permission server events → normalized events for renderer.
    // 4-arg signature: (questionId, toolRequest, tabId, options)
    // tabId comes directly from per-run token registration — no session_id lookup needed.
    this._on(this.permissionServer, 'permission-request', (questionId: string, toolRequest: HookToolRequest, tabId: string, options: PermissionOption[]) => {
      // Verify tab still exists — deny immediately if closed (prevents 5-min timeout hang)
      if (!this.tabs.has(tabId)) {
        log(`Permission request for closed tab ${tabId.substring(0, 8)}… — auto-denying`)
        this.permissionServer.respondToPermission(questionId, 'deny', 'Tab closed')
        return
      }

      log(`Permission request [${questionId}]: tool=${toolRequest.tool_name} tab=${tabId.substring(0, 8)}… mode=${this.permissionMode}`)

      // Auto mode: immediately allow without showing UI
      if (this.permissionMode === 'auto') {
        this.permissionServer.respondToPermission(questionId, 'allow', 'Auto mode')
        return
      }

      // Mask sensitive fields before sending to renderer (defense-in-depth)
      const safeInput = toolRequest.tool_input
        ? maskSensitiveFields(toolRequest.tool_input)
        : undefined

      const permEvent: NormalizedEvent = {
        type: 'permission_request',
        questionId,
        toolName: toolRequest.tool_name,
        toolDescription: undefined,
        toolInput: safeInput,
        options,
      }
      this.emit('event', tabId, permEvent)
    })

    log(`Interactive PTY transport: ${interactivePty ? 'ENABLED' : 'disabled'}`)

    // ─── Wire PtyRunManager events → ControlPlane routing ───
    this._wirePtyEvents()

    // ─── Wire RunManager events → ControlPlane routing ───

    this._on(this.runManager, 'normalized', (requestId: string, event: NormalizedEvent) => {
      const tabId = this._findTabByRequest(requestId)
      if (!tabId) return

      const tab = this.tabs.get(tabId)
      if (!tab) return

      tab.lastActivityAt = Date.now()

      // Handle session init
      if (event.type === 'session_init') {
        tab.claudeSessionId = event.sessionId

        if (this.initRequestIds.has(requestId)) {
          // Warmup init — emit session_init with isWarmup flag, don't change status
          this.emit('event', tabId, { ...event, isWarmup: true })
          return
        }

        if (tab.status === 'connecting') {
          this._setTabStatus(tabId, 'running')
        }
      }

      // Suppress all events from init requests (session_init already handled above)
      if (this.initRequestIds.has(requestId)) {
        return
      }

      this.emit('event', tabId, event)
    })

    this._on(this.runManager, 'exit', (requestId: string, code: number | null, signal: string | null, sessionId: string | null) => {
      // Clean up per-run token
      const runToken = this.runTokens.get(requestId)
      if (runToken) {
        this.permissionServer.unregisterRun(runToken)
        this.runTokens.delete(requestId)
      }

      const tabId = this._findTabByRequest(requestId)

      // Always clean up inflight promise, even if tab was already closed.
      // This prevents leaked promises when closeTab() races with process exit.
      const inflight = this.inflightRequests.get(requestId)

      if (!tabId || !this.tabs.get(tabId)) {
        // Tab was already closed — just resolve/reject the orphaned promise
        if (inflight) {
          inflight.resolve()
          this.inflightRequests.delete(requestId)
        }
        return
      }

      const tab = this.tabs.get(tabId)!

      tab.activeRequestId = null
      tab.runPid = null

      if (sessionId) tab.claudeSessionId = sessionId

      // Init request: silently transition to idle
      if (this.initRequestIds.has(requestId)) {
        this.initRequestIds.delete(requestId)
        this._setTabStatus(tabId, 'idle')
        if (inflight) {
          inflight.resolve()
          this.inflightRequests.delete(requestId)
        }
        this._processQueue(tabId)
        return
      }

      if (code === 0) {
        this._setTabStatus(tabId, 'completed')

        // Generate sandbox diff if this was a sandboxed run (fire-and-forget)
        const sandboxWt = this.worktreeManager.getWorktree(requestId)
        if (sandboxWt) {
          this.gitDiffEngine.getDiff(sandboxWt.path, sandboxWt.baseBranch)
            .then((diff) => {
              this.emit('event', tabId, { type: 'sandbox_diff_ready', runId: requestId, diff })
            })
            .catch((err) => {
              log(`Post-run diff generation failed: ${(err as Error).message}`)
            })
        }
      } else if (signal === 'SIGINT' || signal === 'SIGKILL') {
        // Cancelled by user
        this._setTabStatus(tabId, 'failed')
      } else {
        // Unexpected exit — emit enriched error (includes stderr tail)
        const enriched = this.runManager.getEnrichedError(requestId, code)
        this.emit('error', tabId, enriched)
        this.emit('event', tabId, {
          type: 'session_dead',
          exitCode: code,
          signal,
          stderrTail: enriched.stderrTail,
        })
        this._setTabStatus(tabId, 'dead')
      }

      // Resolve the inflight promise
      if (inflight) {
        inflight.resolve()
        this.inflightRequests.delete(requestId)
      }

      // Process next queued request for this tab
      this._processQueue(tabId)
    })

    this._on(this.runManager, 'error', (requestId: string, err: Error) => {
      // Clean up per-run token
      const runToken = this.runTokens.get(requestId)
      if (runToken) {
        this.permissionServer.unregisterRun(runToken)
        this.runTokens.delete(requestId)
      }

      const tabId = this._findTabByRequest(requestId)

      // Always clean up inflight even if tab is gone
      const inflight = this.inflightRequests.get(requestId)

      if (!tabId || !this.tabs.get(tabId)) {
        if (inflight) {
          inflight.reject(err)
          this.inflightRequests.delete(requestId)
        }
        return
      }

      const tab = this.tabs.get(tabId)!
      tab.activeRequestId = null
      tab.runPid = null

      // Init request: silently fail, go idle so user can still use the tab
      if (this.initRequestIds.has(requestId)) {
        this.initRequestIds.delete(requestId)
        log(`Init session error for tab ${tabId}: ${err.message}`)
        this._setTabStatus(tabId, 'idle')
        if (inflight) {
          inflight.reject(err)
          this.inflightRequests.delete(requestId)
        }
        this._processQueue(tabId)
        return
      }

      this._setTabStatus(tabId, 'dead')

      // Use enriched diagnostics — _finishedRuns holds the handle with
      // stderr/stdout ring buffers even after the process errored out.
      const enriched = this.runManager.getEnrichedError(requestId, null)
      enriched.message = err.message
      this.emit('error', tabId, enriched)

      if (inflight) {
        inflight.reject(err)
        this.inflightRequests.delete(requestId)
      }
    })
  }

  setAgentMemory(agentMemory: AgentMemory): void {
    this.agentMemory = agentMemory
    this.agentMemory.pruneStaleTabs(this.tabs.keys())
  }

  setDigestManager(manager: SessionDigestManager): void {
    this.digestManager = manager
  }

  setCompanionNarrator(narrator: CompanionNarrator): void {
    this.companionNarrator = narrator
  }

  setRetrievalService(service: RetrievalService): void {
    this.retrievalService = service
  }

  /**
   * Wire PtyRunManager events using the same routing logic as RunManager.
   */
  private _wirePtyEvents(): void {
    // Normalized events → same routing as RunManager
    this._on(this.ptyRunManager, 'normalized', (requestId: string, event: NormalizedEvent) => {
      const tabId = this._findTabByRequest(requestId)
      if (!tabId) return

      const tab = this.tabs.get(tabId)
      if (!tab) return

      tab.lastActivityAt = Date.now()

      // Handle session init
      if (event.type === 'session_init') {
        tab.claudeSessionId = event.sessionId

        if (this.initRequestIds.has(requestId)) {
          this.emit('event', tabId, { ...event, isWarmup: true })
          return
        }

        if (tab.status === 'connecting') {
          this._setTabStatus(tabId, 'running')
        }
      }

      // Suppress events from init requests
      if (this.initRequestIds.has(requestId)) return

      this.emit('event', tabId, event)
    })

    // Exit events
    this._on(this.ptyRunManager, 'exit', (requestId: string, code: number | null, signal: number | null, sessionId: string | null) => {
      // Clean up per-run token
      const runToken = this.runTokens.get(requestId)
      if (runToken) {
        this.permissionServer.unregisterRun(runToken)
        this.runTokens.delete(requestId)
      }

      const tabId = this._findTabByRequest(requestId)
      const inflight = this.inflightRequests.get(requestId)

      // Clean up PTY run tracking
      this.ptyRuns.delete(requestId)

      if (!tabId || !this.tabs.get(tabId)) {
        if (inflight) {
          inflight.resolve()
          this.inflightRequests.delete(requestId)
        }
        return
      }

      const tab = this.tabs.get(tabId)!
      tab.activeRequestId = null
      tab.runPid = null
      if (sessionId) tab.claudeSessionId = sessionId

      if (this.initRequestIds.has(requestId)) {
        this.initRequestIds.delete(requestId)
        this._setTabStatus(tabId, 'idle')
        if (inflight) {
          inflight.resolve()
          this.inflightRequests.delete(requestId)
        }
        this._processQueue(tabId)
        return
      }

      if (code === 0) {
        this._setTabStatus(tabId, 'completed')

        // Generate sandbox diff if this was a sandboxed run (fire-and-forget)
        const sandboxWt = this.worktreeManager.getWorktree(requestId)
        if (sandboxWt) {
          this.gitDiffEngine.getDiff(sandboxWt.path, sandboxWt.baseBranch)
            .then((diff) => {
              this.emit('event', tabId, { type: 'sandbox_diff_ready', runId: requestId, diff })
            })
            .catch((err) => {
              log(`Post-run diff generation failed: ${(err as Error).message}`)
            })
        }
      } else if (signal) {
        this._setTabStatus(tabId, 'failed')
      } else {
        const enriched = this.ptyRunManager.getEnrichedError(requestId, code)
        this.emit('error', tabId, enriched)
        this.emit('event', tabId, {
          type: 'session_dead',
          exitCode: code,
          signal: null,
          stderrTail: enriched.stderrTail,
        })
        this._setTabStatus(tabId, 'dead')
      }

      if (inflight) {
        inflight.resolve()
        this.inflightRequests.delete(requestId)
      }

      this._processQueue(tabId)
    })

    // Error events
    this._on(this.ptyRunManager, 'error', (requestId: string, err: Error) => {
      // Clean up per-run token
      const runToken = this.runTokens.get(requestId)
      if (runToken) {
        this.permissionServer.unregisterRun(runToken)
        this.runTokens.delete(requestId)
      }

      const tabId = this._findTabByRequest(requestId)
      const inflight = this.inflightRequests.get(requestId)

      this.ptyRuns.delete(requestId)

      if (!tabId || !this.tabs.get(tabId)) {
        if (inflight) {
          inflight.reject(err)
          this.inflightRequests.delete(requestId)
        }
        return
      }

      const tab = this.tabs.get(tabId)!
      tab.activeRequestId = null
      tab.runPid = null

      if (this.initRequestIds.has(requestId)) {
        this.initRequestIds.delete(requestId)
        log(`PTY init session error for tab ${tabId}: ${err.message}`)
        this._setTabStatus(tabId, 'idle')
        if (inflight) {
          inflight.reject(err)
          this.inflightRequests.delete(requestId)
        }
        this._processQueue(tabId)
        return
      }

      this._setTabStatus(tabId, 'dead')

      const enriched = this.ptyRunManager.getEnrichedError(requestId, null)
      enriched.message = err.message
      this.emit('error', tabId, enriched)

      if (inflight) {
        inflight.reject(err)
        this.inflightRequests.delete(requestId)
      }
    })
  }

  // ─── Tab Lifecycle ───

  createTab(): string {
    const tabId = crypto.randomUUID()
    const entry: TabRegistryEntry = {
      tabId,
      claudeSessionId: null,
      status: 'idle',
      activeRequestId: null,
      runPid: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      promptCount: 0,
      runtime: 'native',
      wslDistro: null,
    }
    this.tabs.set(tabId, entry)
    log(`Tab created: ${tabId}`)
    return tabId
  }

  /**
   * Eagerly initialize a session for a tab by running a minimal prompt.
   * Populates session metadata (model, MCP servers, tools) without visible messages.
   */
  initSession(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    const requestId = `init-${tabId}`
    this.initRequestIds.add(requestId)

    this.submitPrompt(tabId, requestId, {
      prompt: 'hi',
      projectPath: process.cwd(),
      maxTurns: 1,
    }).catch((err) => {
      this.initRequestIds.delete(requestId)
      log(`Init session failed for tab ${tabId}: ${(err as Error).message}`)
    })
  }

  /**
   * Clear stored session ID for a tab — used when working directory changes
   * so _dispatch won't inject a stale --resume from the old directory.
   */
  resetTabSession(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    log(`Resetting session for tab ${tabId} (was: ${tab.claudeSessionId})`)
    tab.claudeSessionId = null
  }

  /**
   * Set global permission mode.
   * 'ask' = show permission cards, 'auto' = auto-approve all tool calls.
   */
  setPermissionMode(mode: 'ask' | 'auto'): void {
    log(`Permission mode set to: ${mode}`)
    this.permissionMode = mode
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    // Cancel active run if any
    if (tab.activeRequestId) {
      this.cancel(tab.activeRequestId)

      // Clean up sandbox worktree for the active run (fire-and-forget)
      this.worktreeManager.removeWorktree(tab.activeRequestId).catch((err) => {
        log(`Sandbox cleanup failed for active run ${tab.activeRequestId}: ${(err as Error).message}`)
      })

      // Resolve and clean up the inflight promise so it doesn't leak.
      // The exit handler may never fire for this tab since we're deleting it.
      const inflight = this.inflightRequests.get(tab.activeRequestId)
      if (inflight) {
        inflight.reject(new Error('Tab closed'))
        this.inflightRequests.delete(tab.activeRequestId)
      }
    }

    // Remove queued requests for this tab, rejecting all waiters
    this.requestQueue = this.requestQueue.filter((r) => {
      if (r.tabId === tabId) {
        const reason = new Error('Tab closed')
        r.reject(reason)
        for (const w of r.extraWaiters) w.reject(reason)
        return false
      }
      return true
    })

    this.tabs.delete(tabId)
    this.agentMemory?.pruneStaleTabs(this.tabs.keys())
    log(`Tab closed: ${tabId}`)
  }

  getAgentMemorySnapshot(projectPath: string): AgentMemorySnapshot {
    this.agentMemory?.pruneStaleTabs(this.tabs.keys())
    return this.agentMemory?.getSnapshot(projectPath) ?? {
      projectPath,
      active: [],
      recentDone: [],
    }
  }

  setAgentFocus(tabId: string, projectPath: string, agentLabel: string, summary: string): {
    snapshot: AgentMemorySnapshot
    assignment?: AgentMemorySnapshot['active'][number]
  } {
    this.agentMemory?.pruneStaleTabs(this.tabs.keys())
    if (!this.agentMemory) {
      return { snapshot: { projectPath, active: [], recentDone: [] } }
    }
    return this.agentMemory.setFocus({ tabId, projectPath, agentLabel, summary })
  }

  claimAgentWork(
    tabId: string,
    projectPath: string,
    agentLabel: string,
    workKey: string,
    summary: string,
  ): AgentMemoryClaimResult {
    this.agentMemory?.pruneStaleTabs(this.tabs.keys())
    if (!this.agentMemory) {
      return {
        ok: true,
        snapshot: { projectPath, active: [], recentDone: [] },
        assignment: {
          tabId,
          agentLabel,
          projectPath,
          workKey,
          summary,
          status: 'active',
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }
    }
    return this.agentMemory.claim({ tabId, projectPath, agentLabel, workKey, summary })
  }

  markAgentDone(tabId: string, note?: string): { ok: boolean; snapshot: AgentMemorySnapshot | null } {
    this.agentMemory?.pruneStaleTabs(this.tabs.keys())
    if (!this.agentMemory) {
      return { ok: false, snapshot: null }
    }
    const result = this.agentMemory.markDone(tabId, note)
    return { ok: result.ok, snapshot: result.snapshot }
  }

  releaseAgentWork(tabId: string): { ok: boolean; snapshots: AgentMemorySnapshot[] } {
    this.agentMemory?.pruneStaleTabs(this.tabs.keys())
    if (!this.agentMemory) {
      return { ok: false, snapshots: [] }
    }
    return this.agentMemory.release(tabId)
  }

  // ─── Submit Prompt ───

  /**
   * Submit a prompt to a specific tab. Returns a promise that resolves
   * when the run completes.
   *
   * Guards:
   *  - Rejects without targetSession (tabId)
   *  - Returns existing promise for duplicate requestId (idempotency)
   *  - Queues if tab is busy, rejects if queue is full
   */
  async submitPrompt(
    tabId: string,
    requestId: string,
    options: RunOptions,
  ): Promise<void> {
    // ─── Guard: target session required ───
    if (!tabId) {
      throw new Error('No targetSession (tabId) provided — rejecting to prevent misrouting')
    }

    const tab = this.tabs.get(tabId)
    if (!tab) {
      throw new Error(`Tab ${tabId} does not exist`)
    }

    // ─── Guard: requestId idempotency (check inflight AND queue) ───
    const existing = this.inflightRequests.get(requestId)
    if (existing) {
      log(`Duplicate requestId ${requestId} — returning existing inflight promise`)
      return existing.promise
    }

    const queued = this.requestQueue.find((r) => r.requestId === requestId)
    if (queued) {
      log(`Duplicate requestId ${requestId} — already queued, adding waiter`)
      return new Promise<void>((resolve, reject) => {
        queued.extraWaiters.push({ resolve, reject })
      })
    }

    // ─── If tab has an active run, queue the request ───
    if (tab.activeRequestId) {
      if (this.requestQueue.length >= MAX_QUEUE_DEPTH) {
        throw new Error('Request queue full — back-pressure')
      }

      log(`Tab ${tabId} busy — queuing request ${requestId} (queue depth: ${this.requestQueue.length + 1})`)
      return new Promise<void>((resolve, reject) => {
        this.requestQueue.push({
          requestId,
          tabId,
          options,
          resolve,
          reject,
          enqueuedAt: Date.now(),
          extraWaiters: [],
        })
      })
    }

    // ─── Dispatch immediately ───
    return this._dispatch(tabId, requestId, options)
  }

  private async _dispatch(tabId: string, requestId: string, options: RunOptions): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error(`Tab ${tabId} disappeared`)

    // Wait for the permission hook server to be ready (or failed).
    // This prevents early prompts from silently falling back to --allowedTools.
    await this.hookServerReady

    // Use stored session ID for resume if available and not overridden
    if (tab.claudeSessionId && !options.sessionId) {
      options = { ...options, sessionId: tab.claudeSessionId }
    }

    if (this.agentMemory) {
      this.agentMemory.pruneStaleTabs(this.tabs.keys())
      const agentMemoryPrompt = this.agentMemory.buildPromptContext(options.projectPath, tabId)
      if (agentMemoryPrompt) {
        options = {
          ...options,
          systemPrompt: [options.systemPrompt, agentMemoryPrompt].filter(Boolean).join('\n\n'),
        }
      }
    }

    // Cross-session digest context injection
    if (this.digestManager) {
      const digestContext = this.digestManager.buildContextInjection(options.projectPath, tabId)
      if (digestContext) {
        options = {
          ...options,
          systemPrompt: [options.systemPrompt, digestContext].filter(Boolean).join('\n\n'),
        }
      }
    }

    // Context database memory packet (smart context injection)
    if (this.retrievalService) {
      const projectId = this.retrievalService.resolveProjectId(options.projectPath || '')
      log(`Context retrieval: path="${options.projectPath}" → projectId=${projectId || 'null'}`)
      if (projectId) {
        const memoryPacket = this.retrievalService.buildSmartPacket(
          projectId, tabId, options.prompt || ''
        )
        log(`Smart context packet: ${memoryPacket ? `${memoryPacket.length} chars` : 'null (no data)'}`)
        if (memoryPacket) {
          options = {
            ...options,
            systemPrompt: [options.systemPrompt, memoryPacket].filter(Boolean).join('\n\n'),
          }
        }
      }
    } else {
      log('Context retrieval: retrievalService not set')
    }

    // Budget enforcement: inject --max-budget-usd if configured and not already set
    if (!options.maxBudgetUsd && this.budgetEnforcer) {
      const cliBudget = this.budgetEnforcer.getCliBudgetForTab(tabId)
      if (cliBudget !== null) {
        options = { ...options, maxBudgetUsd: cliBudget }
      }
    }

    // ─── Sandbox Mode ───
    let sandboxWorktree: WorktreeInfo | null = null
    if (options.sandbox?.enableWorktree) {
      // Pre-run dirty check
      if (options.sandbox.enableDirtyCheck && !options.sandbox.skipDirtyCheck) {
        try {
          const dirty = await this.dirtyDetector.check(options.projectPath)
          if (dirty.isDirty) {
            this.emit('event', tabId, { type: 'sandbox_dirty_warning', runId: requestId, dirty })
            if (options.sandbox.autoStash) {
              await this.dirtyDetector.autoStash(options.projectPath, `CLUI auto-stash ${requestId}`)
            }
          }
        } catch (err) {
          log(`Sandbox dirty check failed: ${(err as Error).message}`)
        }
      }

      // Create isolated worktree
      try {
        sandboxWorktree = await this.worktreeManager.createWorktree(options.projectPath, requestId)
        options = { ...options, projectPath: sandboxWorktree.path }
        this.emit('event', tabId, { type: 'sandbox_worktree_created', worktreeInfo: sandboxWorktree })
        log(`Sandbox worktree ready: ${sandboxWorktree.path}`)
      } catch (err) {
        log(`Sandbox worktree creation failed, running in normal mode: ${(err as Error).message}`)
        // Fall through to normal run — don't block on sandbox failure
      }
    }

    // Per-run token lifecycle: register run, generate per-run settings file
    if (this.permissionServer.getPort()) {
      const runToken = this.permissionServer.registerRun(tabId, requestId, options.sessionId || null)
      this.runTokens.set(requestId, runToken)

      // WSL2 NAT: determine the host IP so the hook URL is reachable from inside WSL
      let wslHookOptions: { distro: string; hostIp: string } | undefined
      if (options.runtime === 'wsl' && options.wslDistro) {
        // Inline require to avoid import-organizer removing the static import
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getWindowsHostIpForWsl } = require('../wsl/detection') as typeof import('../wsl/detection')
        const hostIp = getWindowsHostIpForWsl(options.wslDistro)
        wslHookOptions = { distro: options.wslDistro, hostIp }
      }

      const hookSettingsPath = this.permissionServer.generateSettingsFile(runToken, wslHookOptions)
      options = { ...options, hookSettingsPath }
    }

    tab.activeRequestId = requestId
    if (!this.initRequestIds.has(requestId)) tab.promptCount++
    tab.lastActivityAt = Date.now()

    // Set status to connecting (first run) or running (subsequent)
    const newStatus: TabStatus = tab.claudeSessionId ? 'running' : 'connecting'
    this._setTabStatus(tabId, newStatus)

    // ─── Pick transport ───
    // Stream-json is the stable transport for all regular messages.
    // PTY is reserved for future interactive permission handling only.
    const usePty = false

    let pid: number | null = null
    try {
      if (usePty) {
        log(`Dispatching via PTY transport: ${requestId}`)
        const handle = this.ptyRunManager.startRun(requestId, options)
        this.ptyRuns.add(requestId)
        pid = handle.pid
      } else {
        const handle = this.runManager.startRun(requestId, options)
        pid = handle.pid
      }
      tab.runPid = pid
    } catch (err) {
      // Start failure before inflight registration: rollback tab run state.
      tab.activeRequestId = null
      tab.runPid = null
      this._setTabStatus(tabId, 'failed')
      throw err
    }

    // Create inflight promise
    let resolve!: (value: void) => void
    let reject!: (reason: Error) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })

    this.inflightRequests.set(requestId, { requestId, tabId, promise, resolve, reject })
    return promise
  }

  // ─── Cancel ───

  cancel(requestId: string): boolean {
    // Check if it's in the queue first
    const queueIdx = this.requestQueue.findIndex((r) => r.requestId === requestId)
    if (queueIdx !== -1) {
      const req = this.requestQueue.splice(queueIdx, 1)[0]
      const reason = new Error('Request cancelled')
      req.reject(reason)
      for (const w of req.extraWaiters) w.reject(reason)
      log(`Cancelled queued request ${requestId}`)
      return true
    }

    // Cancel active run — route to correct transport
    if (this.ptyRuns.has(requestId)) {
      return this.ptyRunManager.cancel(requestId)
    }
    return this.runManager.cancel(requestId)
  }

  /**
   * Cancel active run on a tab (by tabId instead of requestId).
   */
  cancelTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId)
    if (!tab?.activeRequestId) return false
    return this.cancel(tab.activeRequestId)
  }

  // ─── Retry ───

  /**
   * Retry: re-submit the same prompt on the same tab/session.
   * If the tab is dead, preserve the stored session ID so Claude can resume.
   */
  async retry(tabId: string, requestId: string, options: RunOptions): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error(`Tab ${tabId} does not exist`)

    // Clear only the dead status; keep the session ID for --resume.
    if (tab.status === 'dead') {
      this._setTabStatus(tabId, 'idle')
    }

    return this.submitPrompt(tabId, requestId, options)
  }

  // ─── Session Forking ───

  /**
   * Fork an existing session into a new independent tab.
   * Uses `--fork-session --resume <parentSessionId>` to create a CLI-level branch.
   * Returns the new tab ID on success.
   */
  async forkSession(sourceTabId: string, projectPath: string): Promise<{ newTabId: string }> {
    const sourceTab = this.tabs.get(sourceTabId)
    if (!sourceTab) throw new Error('Source tab not found')
    if (!sourceTab.claudeSessionId) throw new Error('No session to fork — send a message first')
    if (sourceTab.activeRequestId) throw new Error('Cannot fork while session is running')

    const parentSessionId = sourceTab.claudeSessionId
    const newTabId = this.createTab()

    // Submit a fork prompt on the new tab.
    // The CLI will create a new session ID from the parent and return it in the init event.
    const requestId = `fork-${newTabId}`
    await this.submitPrompt(newTabId, requestId, {
      prompt: 'Continue from where we left off.',
      projectPath,
      forkSession: true,
      forkFromSessionId: parentSessionId,
    })

    return { newTabId }
  }

  // ─── PR Review ───

  /**
   * Open a PR review tab. Spawns Claude with `--from-pr <number>`.
   * Validates that prNumber is a positive integer.
   */
  async openPrReview(prNumber: number, projectPath: string): Promise<{ tabId: string; prNumber: number }> {
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw new Error('Invalid PR number — must be a positive integer')
    }

    const tabId = this.createTab()
    const requestId = `pr-review-${tabId}`

    await this.submitPrompt(tabId, requestId, {
      prompt: `Review PR #${prNumber}`,
      projectPath,
      fromPr: String(prNumber),
    })

    return { tabId, prNumber }
  }

  // ─── Agent Tab ───

  /**
   * Create a new tab configured as an agent tab.
   * The tab will spawn a CLI process with --agent or --agents flags.
   */
  async createAgentTab(
    parentTabId: string,
    agentName: string,
    projectPath: string,
    prompt: string,
    agentConfig?: Record<string, import('../../shared/types').AgentConfig>,
  ): Promise<{ tabId: string }> {
    const parentTab = this.tabs.get(parentTabId)
    if (!parentTab) throw new Error('Parent tab not found')

    // Enforce max agent tabs per group
    const { MAX_AGENT_TABS_PER_GROUP } = await import('./agent-args')
    let agentCount = 0
    for (const [, tab] of this.tabs) {
      // Count tabs that share the same parentTabId (or are parented by parentTabId)
      if ((tab as unknown as { parentTabId?: string }).parentTabId === parentTabId) {
        agentCount++
      }
    }
    if (agentCount >= MAX_AGENT_TABS_PER_GROUP) {
      throw new Error(`Maximum ${MAX_AGENT_TABS_PER_GROUP} agent tabs per group`)
    }

    const tabId = this.createTab()
    log(`Agent tab created: ${tabId} (agent=${agentName}, parent=${parentTabId})`)

    const requestId = `agent-${tabId}`
    const runOptions: import('../../shared/types').RunOptions = {
      prompt,
      projectPath,
      ...(agentConfig ? { agentConfig } : { agent: agentName }),
    }

    await this.submitPrompt(tabId, requestId, runOptions)
    return { tabId }
  }

  /**
   * List available agents by running `claude agents --json`.
   * Returns parsed AgentConfig array (may be empty if no agents configured).
   */
  async listAvailableAgents(): Promise<import('../../shared/types').AgentConfig[]> {
    const { execSync } = await import('child_process')
    const { parseAgentListOutput } = await import('./agent-args')
    const { resolveClaudeEntryPoint } = await import('../platform')
    const entry = resolveClaudeEntryPoint()

    try {
      const cmd = entry.prefixArgs.length > 0
        ? `${entry.binary} ${entry.prefixArgs.join(' ')} agents --json`
        : `${entry.binary} agents --json`
      const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 10000 }).trim()
      return parseAgentListOutput(stdout)
    } catch (err) {
      log(`Failed to list agents: ${(err as Error).message}`)
      return []
    }
  }

  // ─── Permission Response ───

  respondToPermission(tabId: string, questionId: string, optionId: string): boolean {
    // Route to hook server if this is a hook-based permission request.
    // Pass optionId directly — it matches the permission card option IDs
    // (allow, allow-session, allow-domain, deny).
    if (questionId.startsWith('hook-')) {
      return this.permissionServer.respondToPermission(questionId, optionId)
    }

    const tab = this.tabs.get(tabId)
    if (!tab?.activeRequestId) return false

    // Route to correct transport
    if (this.ptyRuns.has(tab.activeRequestId)) {
      return this.ptyRunManager.respondToPermission(tab.activeRequestId, questionId, optionId)
    }

    // Print-json transport: send structured permission response via stdin
    const msg = {
      type: 'permission_response',
      question_id: questionId,
      option_id: optionId,
    }

    return this.runManager.writeToStdin(tab.activeRequestId, msg)
  }

  // ─── Health ───

  getHealth(): HealthReport {
    const tabEntries: HealthReport['tabs'] = []

    for (const [tabId, tab] of this.tabs) {
      let alive = false
      if (tab.activeRequestId) {
        alive = this.runManager.isRunning(tab.activeRequestId)
          || this.ptyRunManager.isRunning(tab.activeRequestId)
      }

      tabEntries.push({
        tabId,
        status: tab.status,
        activeRequestId: tab.activeRequestId,
        claudeSessionId: tab.claudeSessionId,
        alive,
      })
    }

    return {
      tabs: tabEntries,
      queueDepth: this.requestQueue.length,
    }
  }

  getTabStatus(tabId: string): TabRegistryEntry | undefined {
    return this.tabs.get(tabId)
  }

  getEnrichedError(requestId: string, exitCode: number | null): EnrichedError {
    if (this.ptyRuns.has(requestId)) {
      return this.ptyRunManager.getEnrichedError(requestId, exitCode)
    }
    return this.runManager.getEnrichedError(requestId, exitCode)
  }

  // ─── Queue Processing ───

  private _processQueue(tabId: string): void {
    // Find next queued request for this specific tab
    const idx = this.requestQueue.findIndex((r) => r.tabId === tabId)
    if (idx === -1) return

    const req = this.requestQueue.splice(idx, 1)[0]
    log(`Processing queued request ${req.requestId} for tab ${tabId}`)

    this._dispatch(tabId, req.requestId, req.options)
      .then((v) => {
        req.resolve(v)
        for (const w of req.extraWaiters) w.resolve(v)
      })
      .catch((e) => {
        req.reject(e)
        for (const w of req.extraWaiters) w.reject(e)
      })
  }

  // ─── Internal ───

  private _findTabByRequest(requestId: string): string | null {
    const inflight = this.inflightRequests.get(requestId)
    if (inflight) return inflight.tabId

    // Also check registry entries
    for (const [tabId, tab] of this.tabs) {
      if (tab.activeRequestId === requestId) return tabId
    }

    return null
  }

  private _setTabStatus(tabId: string, newStatus: TabStatus): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    const oldStatus = tab.status
    if (oldStatus === newStatus) return

    tab.status = newStatus
    log(`Tab ${tabId}: ${oldStatus} → ${newStatus}`)
    this.emit('tab-status-change', tabId, newStatus, oldStatus)
  }

  // ─── Shutdown ───

  shutdown(): void {
    log('Shutting down control plane')
    // Remove individually tracked listeners to avoid disrupting other code's listeners
    for (const { emitter, event, listener } of this._wiredListeners) {
      emitter.removeListener(event, listener)
    }
    this._wiredListeners = []
    this._eventsWired = false
    this.permissionServer.stop()
    for (const [tabId] of this.tabs) {
      this.closeTab(tabId)
    }
    // Clean up any remaining sandbox worktrees (safety net for orphaned worktrees)
    this.worktreeManager.cleanupAll().catch((err) => {
      log(`Sandbox cleanup on shutdown failed: ${(err as Error).message}`)
    })
  }

  /**
   * Wire a listener and store the reference for clean individual removal in shutdown().
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _on(emitter: EventEmitter, event: string, listener: (...args: any[]) => void): void {
    emitter.on(event, listener)
    this._wiredListeners.push({ emitter, event, listener })
  }
}
