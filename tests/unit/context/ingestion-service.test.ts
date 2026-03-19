import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DatabaseService } from '../../../src/main/context/database-service'
import { IngestionService } from '../../../src/main/context/ingestion-service'
import type { NormalizedEvent, AssistantMessagePayload } from '../../../src/shared/types'

describe('IngestionService', () => {
  let tempDir: string
  let dbPath: string
  let blobsPath: string
  let db: DatabaseService
  let ingestion: IngestionService

  const PROJECT_PATH = '/home/user/my-project'

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clui-ingestion-test-'))
    dbPath = join(tempDir, 'test.sqlite')
    blobsPath = join(tempDir, 'blobs')
    db = new DatabaseService(dbPath, blobsPath)
    db.init()
    ingestion = new IngestionService(db)
  })

  afterEach(() => {
    ingestion.shutdown()
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ── Helper to set up a tab with project + session ──────────────────

  function setupTab(tabId: string): void {
    ingestion.initTab(tabId, PROJECT_PATH)
    ingestion.ensureSession(tabId, PROJECT_PATH)
  }

  function makeAssistantMessage(text: string): AssistantMessagePayload {
    return {
      model: 'claude-sonnet-4-20250514',
      id: 'msg_test',
      role: 'assistant',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    }
  }

  // ── 1. session_init creates project and session ─────────────────────

  describe('session_init', () => {
    it('creates project and session on first init', () => {
      const tabId = 'tab-1'
      ingestion.initTab(tabId, PROJECT_PATH)
      ingestion.ensureSession(tabId, PROJECT_PATH)

      const state = ingestion._getTabState(tabId)
      expect(state).toBeDefined()
      expect(state!.sessionId).toBeTruthy()
      expect(state!.projectId).toBeTruthy()

      // Verify project exists in DB
      const project = db.getProjectByPath(PROJECT_PATH)
      expect(project).not.toBeNull()
      expect(project!.name).toBe('my-project')

      // Verify session exists
      const row = db.db
        .prepare('SELECT status FROM sessions WHERE id = ?')
        .get(state!.sessionId!) as { status: string }
      expect(row.status).toBe('active')
    })

    it('updates claude_session_id on session_init event', () => {
      const tabId = 'tab-2'
      setupTab(tabId)

      ingestion.ingest(tabId, {
        type: 'session_init',
        sessionId: 'claude-sess-abc',
        tools: ['Read', 'Edit', 'Bash'],
        model: 'claude-sonnet-4-20250514',
        mcpServers: [],
        skills: [],
        version: '2.1.63',
      })

      const state = ingestion._getTabState(tabId)
      const row = db.db
        .prepare('SELECT claude_session_id FROM sessions WHERE id = ?')
        .get(state!.sessionId!) as { claude_session_id: string }
      expect(row.claude_session_id).toBe('claude-sess-abc')
    })

    it('skips warmup inits', () => {
      const tabId = 'tab-warmup'
      setupTab(tabId)

      const stateBefore = ingestion._getTabState(tabId)
      const sessionIdBefore = stateBefore!.sessionId

      ingestion.ingest(tabId, {
        type: 'session_init',
        sessionId: 'warmup-sess',
        tools: [],
        model: 'claude-sonnet-4-20250514',
        mcpServers: [],
        skills: [],
        version: '2.1.63',
        isWarmup: true,
      })

      // Session should not be updated with warmup data
      const row = db.db
        .prepare('SELECT claude_session_id FROM sessions WHERE id = ?')
        .get(sessionIdBefore!) as { claude_session_id: string | null }
      expect(row.claude_session_id).toBeNull()
    })
  })

  // ── 2. ingestUserMessage creates user message ───────────────────────

  describe('ingestUserMessage', () => {
    it('creates user message with correct seq_num', () => {
      const tabId = 'tab-user'
      setupTab(tabId)
      const state = ingestion._getTabState(tabId)!

      ingestion.ingestUserMessage(tabId, 'req-1', 'Hello Claude', [])

      const messages = db.db
        .prepare('SELECT role, content, seq_num FROM messages WHERE session_id = ? ORDER BY seq_num')
        .all(state.sessionId!) as Array<{ role: string; content: string; seq_num: number }>

      expect(messages.length).toBe(1)
      expect(messages[0].role).toBe('user')
      expect(messages[0].content).toBe('Hello Claude')
      expect(messages[0].seq_num).toBe(1)
    })

    it('does nothing if session not initialized', () => {
      const tabId = 'tab-no-session'
      // Don't setup — no session
      ingestion.ingestUserMessage(tabId, 'req-1', 'Hello', [])

      const count = db.db
        .prepare('SELECT COUNT(*) as c FROM messages')
        .get() as { c: number }
      expect(count.c).toBe(0)
    })
  })

  // ── 3. text_chunk buffering ─────────────────────────────────────────

  describe('text_chunk buffering', () => {
    it('accumulates chunks without persisting individually', () => {
      const tabId = 'tab-text'
      setupTab(tabId)

      ingestion.ingest(tabId, { type: 'text_chunk', text: 'Hello ' })
      ingestion.ingest(tabId, { type: 'text_chunk', text: 'world' })

      // Nothing should be persisted yet
      const state = ingestion._getTabState(tabId)!
      const count = db.db
        .prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ?')
        .get(state.sessionId!) as { c: number }
      expect(count.c).toBe(0)

      // Buffer should have the chunks
      expect(state.textBuffer).toEqual(['Hello ', 'world'])
    })

    it('flushes on timeout', async () => {
      vi.useFakeTimers()

      const tabId = 'tab-timer'
      setupTab(tabId)

      ingestion.ingest(tabId, { type: 'text_chunk', text: 'delayed text' })

      // Advance past the 5s timeout
      vi.advanceTimersByTime(5001)

      const state = ingestion._getTabState(tabId)!
      const messages = db.db
        .prepare('SELECT content FROM messages WHERE session_id = ? AND role = ?')
        .all(state.sessionId!, 'assistant') as Array<{ content: string }>

      expect(messages.length).toBe(1)
      expect(messages[0].content).toBe('delayed text')

      vi.useRealTimers()
    })
  })

  // ── 4. text_chunk flush on task_update ──────────────────────────────

  describe('text_chunk flush on task_update', () => {
    it('flushes buffer as assistant message when task_update arrives', () => {
      const tabId = 'tab-flush'
      setupTab(tabId)

      // Accumulate text
      ingestion.ingest(tabId, { type: 'text_chunk', text: 'Part 1 ' })
      ingestion.ingest(tabId, { type: 'text_chunk', text: 'Part 2' })

      // task_update should trigger flush
      ingestion.ingest(tabId, {
        type: 'task_update',
        message: makeAssistantMessage('Full response'),
      })

      const state = ingestion._getTabState(tabId)!
      const messages = db.db
        .prepare('SELECT role, content, seq_num FROM messages WHERE session_id = ? ORDER BY seq_num')
        .all(state.sessionId!) as Array<{ role: string; content: string; seq_num: number }>

      // Should have: flushed text (assistant) + task_update message (assistant)
      expect(messages.length).toBe(2)
      expect(messages[0].role).toBe('assistant')
      expect(messages[0].content).toBe('Part 1 Part 2')
      expect(messages[0].seq_num).toBe(1)
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].content).toBe('Full response')
      expect(messages[1].seq_num).toBe(2)
    })
  })

  // ── 5. tool_call creates event and files_touched ────────────────────

  describe('tool_call creates event and files_touched', () => {
    it('persists tool_call event for Edit tool', () => {
      const tabId = 'tab-tool'
      setupTab(tabId)

      ingestion.ingest(tabId, {
        type: 'tool_call',
        toolName: 'Edit',
        toolId: 'tool-1',
        index: 0,
      })

      const state = ingestion._getTabState(tabId)!
      const events = db.db
        .prepare('SELECT event_type, payload_json FROM events WHERE session_id = ?')
        .all(state.sessionId!) as Array<{ event_type: string; payload_json: string }>

      expect(events.length).toBe(1)
      expect(events[0].event_type).toBe('tool_call')
      const payload = JSON.parse(events[0].payload_json)
      expect(payload.toolName).toBe('Edit')
      expect(payload.toolId).toBe('tool-1')
    })

    it('inserts files_touched for Read tool on tool_call_complete', () => {
      const tabId = 'tab-read'
      setupTab(tabId)

      // Start tool call
      ingestion.ingest(tabId, {
        type: 'tool_call',
        toolName: 'Read',
        toolId: 'tool-read-1',
        index: 0,
      })

      // Send partial input
      ingestion.ingest(tabId, {
        type: 'tool_call_update',
        toolId: 'tool-read-1',
        partialInput: '{"file_path": "src/main.ts"}',
      })

      // Complete
      ingestion.ingest(tabId, {
        type: 'tool_call_complete',
        index: 0,
      })

      const state = ingestion._getTabState(tabId)!
      const files = db.db
        .prepare('SELECT path, action FROM files_touched WHERE session_id = ?')
        .all(state.sessionId!) as Array<{ path: string; action: string }>

      expect(files.length).toBeGreaterThanOrEqual(1)
      const readFile = files.find((f) => f.action === 'read')
      expect(readFile).toBeDefined()
      expect(readFile!.path).toBe('src/main.ts')
    })

    it('inserts files_touched for Write tool on tool_call_complete', () => {
      const tabId = 'tab-write'
      setupTab(tabId)

      ingestion.ingest(tabId, {
        type: 'tool_call',
        toolName: 'Write',
        toolId: 'tool-write-1',
        index: 0,
      })

      ingestion.ingest(tabId, {
        type: 'tool_call_update',
        toolId: 'tool-write-1',
        partialInput: '{"file_path": "src/new-file.ts", "content": "export const x = 1;"}',
      })

      ingestion.ingest(tabId, { type: 'tool_call_complete', index: 0 })

      const state = ingestion._getTabState(tabId)!
      const files = db.db
        .prepare('SELECT path, action FROM files_touched WHERE session_id = ?')
        .all(state.sessionId!) as Array<{ path: string; action: string }>

      const writeFile = files.find((f) => f.action === 'write')
      expect(writeFile).toBeDefined()
      expect(writeFile!.path).toBe('src/new-file.ts')
    })

    it('inserts files_touched with patch action for Edit tool', () => {
      const tabId = 'tab-edit'
      setupTab(tabId)

      ingestion.ingest(tabId, {
        type: 'tool_call',
        toolName: 'Edit',
        toolId: 'tool-edit-1',
        index: 0,
      })

      ingestion.ingest(tabId, {
        type: 'tool_call_update',
        toolId: 'tool-edit-1',
        partialInput: '{"path": "src/config.ts", "old_string": "a", "new_string": "b"}',
      })

      ingestion.ingest(tabId, { type: 'tool_call_complete', index: 0 })

      const state = ingestion._getTabState(tabId)!
      const files = db.db
        .prepare('SELECT path, action FROM files_touched WHERE session_id = ?')
        .all(state.sessionId!) as Array<{ path: string; action: string }>

      const patchFile = files.find((f) => f.action === 'patch')
      expect(patchFile).toBeDefined()
      expect(patchFile!.path).toBe('src/config.ts')
    })
  })

  // ── 6. tool_call_complete updates event ─────────────────────────────

  describe('tool_call_complete', () => {
    it('persists tool_call_complete event with accumulated input', () => {
      const tabId = 'tab-complete'
      setupTab(tabId)

      ingestion.ingest(tabId, {
        type: 'tool_call',
        toolName: 'Bash',
        toolId: 'tool-bash-1',
        index: 0,
      })

      ingestion.ingest(tabId, {
        type: 'tool_call_update',
        toolId: 'tool-bash-1',
        partialInput: '{"command"',
      })

      ingestion.ingest(tabId, {
        type: 'tool_call_update',
        toolId: 'tool-bash-1',
        partialInput: ': "npm test"}',
      })

      ingestion.ingest(tabId, { type: 'tool_call_complete', index: 0 })

      const state = ingestion._getTabState(tabId)!
      const events = db.db
        .prepare('SELECT event_type, payload_json FROM events WHERE session_id = ? ORDER BY seq_num')
        .all(state.sessionId!) as Array<{ event_type: string; payload_json: string }>

      const completeEvent = events.find((e) => e.event_type === 'tool_call_complete')
      expect(completeEvent).toBeDefined()

      const payload = JSON.parse(completeEvent!.payload_json)
      expect(payload.input).toBe('{"command": "npm test"}')
      expect(payload.toolName).toBe('Bash')
    })
  })

  // ── 7. task_complete sets session status to completed ───────────────

  describe('task_complete', () => {
    it('sets session status to completed and creates summary', () => {
      const tabId = 'tab-tc'
      setupTab(tabId)
      const state = ingestion._getTabState(tabId)!

      // Add some context so the summary has content
      ingestion.ingestUserMessage(tabId, 'req-1', 'Fix the bug', [])

      // Simulate a tool call
      ingestion.ingest(tabId, {
        type: 'tool_call',
        toolName: 'Edit',
        toolId: 'tool-1',
        index: 0,
      })

      ingestion.ingest(tabId, {
        type: 'tool_call_update',
        toolId: 'tool-1',
        partialInput: '{"file_path": "src/app.ts", "old_string": "bug", "new_string": "fix"}',
      })

      ingestion.ingest(tabId, { type: 'tool_call_complete', index: 0 })

      // Now complete
      const events: Array<{ type: string; payload: unknown }> = []
      ingestion.on('session-recorded', (payload) => events.push({ type: 'session-recorded', payload }))
      ingestion.on('memory-created', (payload) => events.push({ type: 'memory-created', payload }))

      ingestion.ingest(tabId, {
        type: 'task_complete',
        result: 'Done',
        costUsd: 0.05,
        durationMs: 30000,
        numTurns: 3,
        usage: { input_tokens: 500, output_tokens: 200 },
        sessionId: 'claude-sess-1',
      })

      // Session should be completed
      const row = db.db
        .prepare('SELECT status, ended_at FROM sessions WHERE id = ?')
        .get(state.sessionId!) as { status: string; ended_at: string | null }
      expect(row.status).toBe('completed')
      expect(row.ended_at).not.toBeNull()

      // Summary should exist
      const summaryRow = db.db
        .prepare('SELECT body FROM session_summaries WHERE session_id = ? AND summary_kind = ?')
        .get(state.sessionId!, 'technical') as { body: string } | undefined
      expect(summaryRow).toBeDefined()
      expect(summaryRow!.body).toContain('Status: completed')

      // Should have emitted events
      expect(events.some((e) => e.type === 'session-recorded')).toBe(true)
      expect(events.some((e) => e.type === 'memory-created')).toBe(true)
    })

    it('creates session_outcome memory with correct importance', () => {
      const tabId = 'tab-memory'
      setupTab(tabId)
      const state = ingestion._getTabState(tabId)!

      ingestion.ingest(tabId, {
        type: 'task_complete',
        result: 'Done',
        costUsd: 0.01,
        durationMs: 5000,
        numTurns: 1,
        usage: {},
        sessionId: 'sess-1',
      })

      const memories = db.db
        .prepare('SELECT memory_type, scope, importance_score, confidence_score FROM memories WHERE session_id = ?')
        .all(state.sessionId!) as Array<{
        memory_type: string
        scope: string
        importance_score: number
        confidence_score: number
      }>

      expect(memories.length).toBe(1)
      expect(memories[0].memory_type).toBe('session_outcome')
      expect(memories[0].scope).toBe('project')
      expect(memories[0].confidence_score).toBe(1.0)
      // Base (0.5) + completed (0.1) = 0.6
      expect(memories[0].importance_score).toBeCloseTo(0.6, 1)
    })
  })

  // ── 8. session_dead sets session status to dead ─────────────────────

  describe('session_dead', () => {
    it('sets session status to dead and flushes buffers', () => {
      const tabId = 'tab-dead'
      setupTab(tabId)
      const state = ingestion._getTabState(tabId)!

      // Accumulate some text
      ingestion.ingest(tabId, { type: 'text_chunk', text: 'partial output' })

      ingestion.ingest(tabId, {
        type: 'session_dead',
        exitCode: 1,
        signal: null,
        stderrTail: ['error: something went wrong'],
      })

      // Session should be dead
      const row = db.db
        .prepare('SELECT status, ended_at FROM sessions WHERE id = ?')
        .get(state.sessionId!) as { status: string; ended_at: string | null }
      expect(row.status).toBe('dead')
      expect(row.ended_at).not.toBeNull()

      // Text should have been flushed
      const messages = db.db
        .prepare('SELECT content FROM messages WHERE session_id = ? AND role = ?')
        .all(state.sessionId!, 'assistant') as Array<{ content: string }>
      expect(messages.length).toBe(1)
      expect(messages[0].content).toBe('partial output')

      // session_dead event should be persisted
      const events = db.db
        .prepare('SELECT event_type, payload_json FROM events WHERE session_id = ? AND event_type = ?')
        .all(state.sessionId!, 'session_dead') as Array<{ event_type: string; payload_json: string }>
      expect(events.length).toBe(1)
    })
  })

  // ── 9. onTabClosed flushes and sets abandoned ───────────────────────

  describe('onTabClosed', () => {
    it('flushes buffers and sets abandoned if session is active', () => {
      const tabId = 'tab-closed'
      setupTab(tabId)
      const state = ingestion._getTabState(tabId)!
      const sessionId = state.sessionId!

      // Add some buffered text
      ingestion.ingest(tabId, { type: 'text_chunk', text: 'unfinished' })

      ingestion.onTabClosed(tabId)

      // Session should be abandoned
      const row = db.db
        .prepare('SELECT status, ended_at FROM sessions WHERE id = ?')
        .get(sessionId) as { status: string; ended_at: string | null }
      expect(row.status).toBe('abandoned')
      expect(row.ended_at).not.toBeNull()

      // Text should have been flushed
      const messages = db.db
        .prepare('SELECT content FROM messages WHERE session_id = ? AND role = ?')
        .all(sessionId, 'assistant') as Array<{ content: string }>
      expect(messages.length).toBe(1)
      expect(messages[0].content).toBe('unfinished')

      // Tab state should be cleaned up
      expect(ingestion._getTabState(tabId)).toBeUndefined()
    })

    it('does not set abandoned if session is already completed', () => {
      const tabId = 'tab-closed-completed'
      setupTab(tabId)
      const state = ingestion._getTabState(tabId)!
      const sessionId = state.sessionId!

      // Complete the session first
      ingestion.ingest(tabId, {
        type: 'task_complete',
        result: 'Done',
        costUsd: 0.01,
        durationMs: 1000,
        numTurns: 1,
        usage: {},
        sessionId: 'sess-1',
      })

      ingestion.onTabClosed(tabId)

      // Should still be completed, not abandoned
      const row = db.db
        .prepare('SELECT status FROM sessions WHERE id = ?')
        .get(sessionId) as { status: string }
      expect(row.status).toBe('completed')
    })
  })

  // ── 10. Error isolation ─────────────────────────────────────────────

  describe('error isolation', () => {
    it('does not throw when ingestion fails', () => {
      const tabId = 'tab-error-iso'
      // Don't setup — no session, which causes internal access to null state

      // This should not throw even though there's no session
      expect(() => {
        ingestion.ingest(tabId, {
          type: 'task_complete',
          result: 'Done',
          costUsd: 0,
          durationMs: 0,
          numTurns: 0,
          usage: {},
          sessionId: 'sess-1',
        })
      }).not.toThrow()
    })

    it('enters degraded mode after repeated errors', () => {
      // Force errors by making the db throw
      const originalInsertEvent = db.insertEvent.bind(db)
      db.insertEvent = () => {
        throw new Error('DB locked')
      }

      const tabId = 'tab-degrade'
      setupTab(tabId)

      // Trigger 3 errors (degraded threshold)
      for (let i = 0; i < 3; i++) {
        ingestion.ingest(tabId, {
          type: 'error',
          message: 'test error',
          isError: true,
        })
      }

      // Should now be in degraded mode
      expect(ingestion._getDegradedUntil()).toBeGreaterThan(Date.now())

      // Restore
      db.insertEvent = originalInsertEvent
    })

    it('recovers from degraded mode after cooldown', () => {
      const tabId = 'tab-recover'
      setupTab(tabId)

      // Set degraded to have expired already
      ingestion._setDegradedUntil(Date.now() - 1000)
      ingestion._setConsecutiveErrors(5)

      // Should process events again
      ingestion.ingestUserMessage(tabId, 'req-1', 'Hello', [])

      const state = ingestion._getTabState(tabId)!
      const count = db.db
        .prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ?')
        .get(state.sessionId!) as { c: number }
      expect(count.c).toBe(1)
    })
  })

  // ── 11. Correct seq_num incrementing ────────────────────────────────

  describe('seq_num incrementing', () => {
    it('increments message seq_num across multiple messages', () => {
      const tabId = 'tab-seq'
      setupTab(tabId)
      const state = ingestion._getTabState(tabId)!

      ingestion.ingestUserMessage(tabId, 'req-1', 'First message', [])
      ingestion.ingestUserMessage(tabId, 'req-2', 'Second message', [])

      // task_update will flush buffer and create assistant message
      ingestion.ingest(tabId, { type: 'text_chunk', text: 'Response text' })
      ingestion.ingest(tabId, {
        type: 'task_update',
        message: makeAssistantMessage('Full response'),
      })

      const messages = db.db
        .prepare('SELECT role, seq_num FROM messages WHERE session_id = ? ORDER BY seq_num')
        .all(state.sessionId!) as Array<{ role: string; seq_num: number }>

      expect(messages.length).toBe(4)
      expect(messages[0]).toEqual({ role: 'user', seq_num: 1 })
      expect(messages[1]).toEqual({ role: 'user', seq_num: 2 })
      expect(messages[2]).toEqual({ role: 'assistant', seq_num: 3 }) // flushed buffer
      expect(messages[3]).toEqual({ role: 'assistant', seq_num: 4 }) // task_update message
    })

    it('increments event seq_num across multiple events', () => {
      const tabId = 'tab-event-seq'
      setupTab(tabId)
      const state = ingestion._getTabState(tabId)!

      // Tool call → 1 event
      ingestion.ingest(tabId, {
        type: 'tool_call',
        toolName: 'Read',
        toolId: 'tool-1',
        index: 0,
      })

      // Tool call complete → 1 event
      ingestion.ingest(tabId, { type: 'tool_call_complete', index: 0 })

      // Error → 1 event
      ingestion.ingest(tabId, {
        type: 'error',
        message: 'something failed',
        isError: true,
      })

      const events = db.db
        .prepare('SELECT event_type, seq_num FROM events WHERE session_id = ? ORDER BY seq_num')
        .all(state.sessionId!) as Array<{ event_type: string; seq_num: number }>

      expect(events.length).toBe(3)
      expect(events[0]).toEqual({ event_type: 'tool_call', seq_num: 1 })
      expect(events[1]).toEqual({ event_type: 'tool_call_complete', seq_num: 2 })
      expect(events[2]).toEqual({ event_type: 'error', seq_num: 3 })
    })
  })

  // ── Additional edge cases ───────────────────────────────────────────

  describe('edge cases', () => {
    it('handles tool_call flush of pending text', () => {
      const tabId = 'tab-tool-flush'
      setupTab(tabId)

      ingestion.ingest(tabId, { type: 'text_chunk', text: 'thinking...' })

      // tool_call should flush the text buffer
      ingestion.ingest(tabId, {
        type: 'tool_call',
        toolName: 'Bash',
        toolId: 'tool-1',
        index: 0,
      })

      const state = ingestion._getTabState(tabId)!
      const messages = db.db
        .prepare('SELECT content FROM messages WHERE session_id = ? AND role = ?')
        .all(state.sessionId!, 'assistant') as Array<{ content: string }>

      expect(messages.length).toBe(1)
      expect(messages[0].content).toBe('thinking...')
    })

    it('handles multiple tabs independently', () => {
      const tab1 = 'tab-multi-1'
      const tab2 = 'tab-multi-2'

      setupTab(tab1)
      setupTab(tab2)

      ingestion.ingestUserMessage(tab1, 'req-1', 'Tab 1 message', [])
      ingestion.ingestUserMessage(tab2, 'req-2', 'Tab 2 message', [])

      const state1 = ingestion._getTabState(tab1)!
      const state2 = ingestion._getTabState(tab2)!

      // Different sessions
      expect(state1.sessionId).not.toBe(state2.sessionId)

      // Each has its own message
      const msgs1 = db.db
        .prepare('SELECT content FROM messages WHERE session_id = ?')
        .all(state1.sessionId!) as Array<{ content: string }>
      const msgs2 = db.db
        .prepare('SELECT content FROM messages WHERE session_id = ?')
        .all(state2.sessionId!) as Array<{ content: string }>

      expect(msgs1.length).toBe(1)
      expect(msgs1[0].content).toBe('Tab 1 message')
      expect(msgs2.length).toBe(1)
      expect(msgs2[0].content).toBe('Tab 2 message')
    })

    it('handles permission_request event', () => {
      const tabId = 'tab-perm'
      setupTab(tabId)

      ingestion.ingest(tabId, {
        type: 'permission_request',
        questionId: 'q-1',
        toolName: 'Bash',
        toolDescription: 'Run shell command',
        options: [{ id: 'allow', label: 'Allow', kind: 'allow' }],
      })

      const state = ingestion._getTabState(tabId)!
      const events = db.db
        .prepare('SELECT event_type, payload_json FROM events WHERE session_id = ?')
        .all(state.sessionId!) as Array<{ event_type: string; payload_json: string }>

      expect(events.length).toBe(1)
      expect(events[0].event_type).toBe('permission_request')
      const payload = JSON.parse(events[0].payload_json)
      expect(payload.toolName).toBe('Bash')
    })

    it('handles rate_limit event', () => {
      const tabId = 'tab-rate'
      setupTab(tabId)

      ingestion.ingest(tabId, {
        type: 'rate_limit',
        status: 'rate_limited',
        resetsAt: 1679000000,
        rateLimitType: 'tokens',
      })

      const state = ingestion._getTabState(tabId)!
      const events = db.db
        .prepare('SELECT event_type FROM events WHERE session_id = ?')
        .all(state.sessionId!) as Array<{ event_type: string }>

      expect(events.length).toBe(1)
      expect(events[0].event_type).toBe('rate_limit')
    })

    it('handles usage event', () => {
      const tabId = 'tab-usage'
      setupTab(tabId)

      ingestion.ingest(tabId, {
        type: 'usage',
        usage: { input_tokens: 100, output_tokens: 50 },
      })

      const state = ingestion._getTabState(tabId)!
      const events = db.db
        .prepare('SELECT event_type FROM events WHERE session_id = ?')
        .all(state.sessionId!) as Array<{ event_type: string }>

      expect(events.length).toBe(1)
      expect(events[0].event_type).toBe('usage')
    })
  })
})
