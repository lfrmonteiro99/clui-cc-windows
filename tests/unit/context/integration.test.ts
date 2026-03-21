import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DatabaseService } from '../../../src/main/context/database-service'
import { IngestionService } from '../../../src/main/context/ingestion-service'
import { RetrievalService } from '../../../src/main/context/retrieval-service'
import type { NormalizedEvent } from '../../../src/shared/types'
import { __initSqlWasm } from '../../__mocks__/better-sqlite3'

beforeAll(async () => {
  await __initSqlWasm()
})

describe('Context Database Integration', () => {
  let tempDir: string
  let db: DatabaseService
  let ingestion: IngestionService
  let retrieval: RetrievalService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clui-integration-test-'))
    const dbPath = join(tempDir, 'test.sqlite')
    const blobsPath = join(tempDir, 'blobs')
    db = new DatabaseService(dbPath, blobsPath)
    db.init()
    ingestion = new IngestionService(db)
    retrieval = new RetrievalService(db)
  })

  afterEach(() => {
    ingestion.shutdown()
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ── 1. Full pipeline: prompt -> events -> DB -> retrieval ───────────

  describe('full pipeline: prompt -> events -> DB -> retrieval', () => {
    it('ingests a complete session and retrieves it via memory packet', () => {
      const tabId = 'tab-1'
      const projectPath = '/home/user/project'

      // Initialize tab and session
      ingestion.initTab(tabId, projectPath)
      ingestion.ensureSession(tabId, projectPath)

      // Capture the internal session state for verification
      const tabState = ingestion._getTabState(tabId)
      expect(tabState).toBeDefined()
      expect(tabState!.sessionId).toBeTruthy()
      expect(tabState!.projectId).toBeTruthy()

      const sessionId = tabState!.sessionId!
      const projectId = tabState!.projectId!

      // Ingest user message
      ingestion.ingestUserMessage(tabId, 'req-1', 'Fix the auth bug', [])

      // Ingest text_chunk events (assistant thinking)
      ingestion.ingest(tabId, { type: 'text_chunk', text: 'I will fix the ' } as NormalizedEvent)
      ingestion.ingest(tabId, { type: 'text_chunk', text: 'authentication bug.' } as NormalizedEvent)

      // Ingest tool_call: Read tool with file_path
      ingestion.ingest(tabId, {
        type: 'tool_call',
        toolName: 'Read',
        toolId: 'tool-read-1',
        index: 0,
      } as NormalizedEvent)

      // tool_call_update with partial input
      ingestion.ingest(tabId, {
        type: 'tool_call_update',
        toolId: 'tool-read-1',
        partialInput: '{"file_path": "src/auth/handler.ts"}',
      } as NormalizedEvent)

      // tool_call_complete
      ingestion.ingest(tabId, {
        type: 'tool_call_complete',
        index: 0,
      } as NormalizedEvent)

      // Ingest tool_call: Edit tool
      ingestion.ingest(tabId, {
        type: 'tool_call',
        toolName: 'Edit',
        toolId: 'tool-edit-1',
        index: 1,
      } as NormalizedEvent)

      // tool_call_update for Edit
      ingestion.ingest(tabId, {
        type: 'tool_call_update',
        toolId: 'tool-edit-1',
        partialInput: '{"path": "src/auth/handler.ts", "old_string": "broken", "new_string": "fixed"}',
      } as NormalizedEvent)

      // tool_call_complete for Edit
      ingestion.ingest(tabId, {
        type: 'tool_call_complete',
        index: 1,
      } as NormalizedEvent)

      // Listen for emitted events
      const emitted: Array<{ type: string; payload: unknown }> = []
      ingestion.on('session-recorded', (payload) =>
        emitted.push({ type: 'session-recorded', payload }),
      )
      ingestion.on('memory-created', (payload) =>
        emitted.push({ type: 'memory-created', payload }),
      )

      // Ingest task_complete
      ingestion.ingest(tabId, {
        type: 'task_complete',
        result: 'Fixed the auth bug',
        costUsd: 0.05,
        durationMs: 45000,
        numTurns: 3,
        usage: { input_tokens: 1000, output_tokens: 500 },
        sessionId: 'claude-sess-abc',
      } as NormalizedEvent)

      // ── Verify session in DB ─────────────────────────────────────────
      const sessionRow = db.db
        .prepare('SELECT status, ended_at FROM sessions WHERE id = ?')
        .get(sessionId) as { status: string; ended_at: string | null }
      expect(sessionRow.status).toBe('completed')
      expect(sessionRow.ended_at).not.toBeNull()

      // ── Verify messages (user + assistant) ───────────────────────────
      const messages = db.db
        .prepare(
          'SELECT role, content, seq_num FROM messages WHERE session_id = ? AND deleted_at IS NULL ORDER BY seq_num',
        )
        .all(sessionId) as Array<{ role: string; content: string; seq_num: number }>

      // user message + flushed text_chunk assistant message
      expect(messages.length).toBeGreaterThanOrEqual(2)
      expect(messages[0].role).toBe('user')
      expect(messages[0].content).toBe('Fix the auth bug')

      const assistantMsg = messages.find((m) => m.role === 'assistant')
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg!.content).toContain('I will fix the authentication bug.')

      // ── Verify events ────────────────────────────────────────────────
      const events = db.db
        .prepare(
          'SELECT event_type, seq_num FROM events WHERE session_id = ? AND deleted_at IS NULL ORDER BY seq_num',
        )
        .all(sessionId) as Array<{ event_type: string; seq_num: number }>

      const eventTypes = events.map((e) => e.event_type)
      expect(eventTypes).toContain('tool_call')
      expect(eventTypes).toContain('tool_call_complete')
      expect(eventTypes).toContain('task_complete')

      // ── Verify files_touched records ─────────────────────────────────
      const filesTouched = db.db
        .prepare(
          'SELECT path, action FROM files_touched WHERE session_id = ? AND deleted_at IS NULL',
        )
        .all(sessionId) as Array<{ path: string; action: string }>

      expect(filesTouched.length).toBeGreaterThanOrEqual(1)
      const readEntry = filesTouched.find((f) => f.action === 'read')
      expect(readEntry).toBeDefined()
      expect(readEntry!.path).toBe('src/auth/handler.ts')

      const patchEntry = filesTouched.find((f) => f.action === 'patch')
      expect(patchEntry).toBeDefined()
      expect(patchEntry!.path).toBe('src/auth/handler.ts')

      // ── Verify session_outcome memory was created ────────────────────
      const memories = db.db
        .prepare(
          "SELECT memory_type, title, body FROM memories WHERE session_id = ? AND deleted_at IS NULL AND memory_type = 'session_outcome'",
        )
        .all(sessionId) as Array<{ memory_type: string; title: string; body: string | null }>

      expect(memories.length).toBe(1)
      expect(memories[0].memory_type).toBe('session_outcome')

      // ── Verify emitted events ────────────────────────────────────────
      expect(emitted.some((e) => e.type === 'session-recorded')).toBe(true)
      expect(emitted.some((e) => e.type === 'memory-created')).toBe(true)

      // ── Retrieval: resolveProjectId ──────────────────────────────────
      const resolvedProjectId = retrieval.resolveProjectId(projectPath)
      expect(resolvedProjectId).toBe(projectId)

      // ── Retrieval: buildMemoryPacket ─────────────────────────────────
      const packet = retrieval.buildMemoryPacket(projectId, tabId, 'auth bug')
      expect(packet).not.toBeNull()
      expect(typeof packet).toBe('string')
      expect(packet!).toContain('<clui_context>')
      expect(packet!).toContain('</clui_context>')
      expect(packet!).toContain('<project name="project"')
    })
  })

  // ── 2. Memory extractors fire on task_complete ──────────────────────

  describe('memory extractors fire on task_complete and create extractable memories', () => {
    it('creates file_pattern, tool_preference, and session_outcome memories', () => {
      const projectPath = '/home/user/extractor-project'

      // ── Session 1 ────────────────────────────────────────────────────
      const tab1 = 'tab-ext-1'
      ingestion.initTab(tab1, projectPath)
      ingestion.ensureSession(tab1, projectPath)
      const state1 = ingestion._getTabState(tab1)!
      const session1Id = state1.sessionId!
      const projectId = state1.projectId!

      ingestion.ingestUserMessage(tab1, 'req-1', 'Refactor auth module', [])

      // Insert 3 Read tool calls for the same file (contributes to file_pattern threshold)
      for (let i = 0; i < 3; i++) {
        ingestion.ingest(tab1, {
          type: 'tool_call',
          toolName: 'Read',
          toolId: `tool-r1-${i}`,
          index: i,
        } as NormalizedEvent)
        ingestion.ingest(tab1, {
          type: 'tool_call_update',
          toolId: `tool-r1-${i}`,
          partialInput: '{"file_path": "src/core/auth.ts"}',
        } as NormalizedEvent)
        ingestion.ingest(tab1, {
          type: 'tool_call_complete',
          index: i,
        } as NormalizedEvent)
      }

      // Complete session 1
      ingestion.ingest(tab1, {
        type: 'task_complete',
        result: 'Refactored auth',
        costUsd: 0.03,
        durationMs: 20000,
        numTurns: 2,
        usage: { input_tokens: 500, output_tokens: 200 },
        sessionId: 'claude-s1',
      } as NormalizedEvent)

      // ── Session 2 (same project, different tab) ──────────────────────
      const tab2 = 'tab-ext-2'
      ingestion.initTab(tab2, projectPath)
      ingestion.ensureSession(tab2, projectPath)
      const state2 = ingestion._getTabState(tab2)!
      const session2Id = state2.sessionId!

      ingestion.ingestUserMessage(tab2, 'req-2', 'Add tests for auth', [])

      // Insert 3 more Read tool calls for the same file (total across sessions >= 5, across >= 2 sessions)
      for (let i = 0; i < 3; i++) {
        ingestion.ingest(tab2, {
          type: 'tool_call',
          toolName: 'Read',
          toolId: `tool-r2-${i}`,
          index: i,
        } as NormalizedEvent)
        ingestion.ingest(tab2, {
          type: 'tool_call_update',
          toolId: `tool-r2-${i}`,
          partialInput: '{"file_path": "src/core/auth.ts"}',
        } as NormalizedEvent)
        ingestion.ingest(tab2, {
          type: 'tool_call_complete',
          index: i,
        } as NormalizedEvent)
      }

      // Complete session 2 — this triggers extractors
      ingestion.ingest(tab2, {
        type: 'task_complete',
        result: 'Added auth tests',
        costUsd: 0.02,
        durationMs: 15000,
        numTurns: 2,
        usage: { input_tokens: 400, output_tokens: 150 },
        sessionId: 'claude-s2',
      } as NormalizedEvent)

      // ── Verify file_pattern memory ───────────────────────────────────
      // file_pattern requires >= 5 touches across >= 2 sessions
      // Session 1: 3 tool_call_complete events, each inserts a files_touched for Read
      // Session 2: 3 more. Total: 6 touches across 2 sessions. Should meet threshold.
      const filePatterns = db.db
        .prepare(
          "SELECT title, body FROM memories WHERE project_id = ? AND memory_type = 'file_pattern' AND deleted_at IS NULL",
        )
        .all(projectId) as Array<{ title: string; body: string }>

      expect(filePatterns.length).toBeGreaterThanOrEqual(1)
      expect(filePatterns[0].title).toBe('src/core/auth.ts')
      expect(filePatterns[0].body).toContain('Frequently edited file')

      // ── Verify tool_preference memory ────────────────────────────────
      const toolPrefs = db.db
        .prepare(
          "SELECT title, body FROM memories WHERE project_id = ? AND memory_type = 'tool_preference' AND deleted_at IS NULL",
        )
        .all(projectId) as Array<{ title: string; body: string }>

      expect(toolPrefs.length).toBe(1)
      expect(toolPrefs[0].title).toBe('Tool usage distribution')
      expect(toolPrefs[0].body).toContain('Read')

      // ── Verify session_outcome memories (one per session) ────────────
      const outcomes = db.db
        .prepare(
          "SELECT session_id FROM memories WHERE project_id = ? AND memory_type = 'session_outcome' AND deleted_at IS NULL",
        )
        .all(projectId) as Array<{ session_id: string }>

      const outcomeSessionIds = outcomes.map((o) => o.session_id)
      expect(outcomeSessionIds).toContain(session1Id)
      expect(outcomeSessionIds).toContain(session2Id)
    })
  })

  // ── 3. Pruning respects pinned extractor memories ───────────────────

  describe('pruning respects pinned extractor memories', () => {
    it('prunes unpinned stale memories but preserves pinned ones', () => {
      const projectPath = '/home/user/prune-project'
      const tabId = 'tab-prune'

      ingestion.initTab(tabId, projectPath)
      ingestion.ensureSession(tabId, projectPath)
      const state = ingestion._getTabState(tabId)!
      const sessionId = state.sessionId!
      const projectId = state.projectId!

      ingestion.ingestUserMessage(tabId, 'req-1', 'Setup project', [])

      // Insert enough tool calls to generate tool_preference
      for (let i = 0; i < 3; i++) {
        ingestion.ingest(tabId, {
          type: 'tool_call',
          toolName: 'Read',
          toolId: `tool-p-${i}`,
          index: i,
        } as NormalizedEvent)
        ingestion.ingest(tabId, {
          type: 'tool_call_update',
          toolId: `tool-p-${i}`,
          partialInput: '{"file_path": "src/index.ts"}',
        } as NormalizedEvent)
        ingestion.ingest(tabId, {
          type: 'tool_call_complete',
          index: i,
        } as NormalizedEvent)
      }

      // Complete session — triggers extractors, creates session_outcome
      ingestion.ingest(tabId, {
        type: 'task_complete',
        result: 'Setup done',
        costUsd: 0.01,
        durationMs: 5000,
        numTurns: 1,
        usage: {},
        sessionId: 'claude-prune-1',
      } as NormalizedEvent)

      // Verify memories were created
      const allMemories = db.db
        .prepare(
          'SELECT id, memory_type, importance_score FROM memories WHERE project_id = ? AND deleted_at IS NULL',
        )
        .all(projectId) as Array<{ id: string; memory_type: string; importance_score: number }>

      expect(allMemories.length).toBeGreaterThanOrEqual(1)

      // Pin one memory
      const memoryToPin = allMemories[0]
      db.pinMemory(memoryToPin.id)

      // Backdate ALL memories to >90 days ago and set low importance for pruning eligibility
      for (const mem of allMemories) {
        db.db
          .prepare(
            `UPDATE memories SET
               created_at = datetime('now', '-100 days'),
               updated_at = datetime('now', '-100 days'),
               last_accessed_at = NULL,
               importance_score = 0.1
             WHERE id = ?`,
          )
          .run(mem.id)
      }

      // Run pruning
      const pruneCount = db.pruneStaleMemories()

      // The pinned memory should survive; unpinned stale ones should be pruned
      const survivingMemories = db.db
        .prepare(
          'SELECT id, is_pinned FROM memories WHERE project_id = ? AND deleted_at IS NULL',
        )
        .all(projectId) as Array<{ id: string; is_pinned: number }>

      // Pinned memory must survive
      const pinnedSurvivor = survivingMemories.find((m) => m.id === memoryToPin.id)
      expect(pinnedSurvivor).toBeDefined()
      expect(pinnedSurvivor!.is_pinned).toBe(1)

      // At least some unpinned memories should have been pruned
      if (allMemories.length > 1) {
        expect(pruneCount).toBeGreaterThanOrEqual(1)
        // Surviving count should be less than original
        expect(survivingMemories.length).toBeLessThan(allMemories.length)
      }
    })
  })

  // ── 4. Multi-tab isolation ──────────────────────────────────────────

  describe('multi-tab isolation', () => {
    it('keeps sessions and events isolated between tabs with different projects', () => {
      const projectA = '/home/user/project-alpha'
      const projectB = '/home/user/project-beta'

      const tabA = 'tab-iso-a'
      const tabB = 'tab-iso-b'

      // Init both tabs with different projects
      ingestion.initTab(tabA, projectA)
      ingestion.ensureSession(tabA, projectA)
      ingestion.initTab(tabB, projectB)
      ingestion.ensureSession(tabB, projectB)

      const stateA = ingestion._getTabState(tabA)!
      const stateB = ingestion._getTabState(tabB)!

      expect(stateA.projectId).not.toBe(stateB.projectId)
      expect(stateA.sessionId).not.toBe(stateB.sessionId)

      // Ingest events on both tabs concurrently
      ingestion.ingestUserMessage(tabA, 'req-a1', 'Fix alpha bug', [])
      ingestion.ingestUserMessage(tabB, 'req-b1', 'Fix beta bug', [])

      ingestion.ingest(tabA, {
        type: 'tool_call',
        toolName: 'Read',
        toolId: 'tool-a-1',
        index: 0,
      } as NormalizedEvent)

      ingestion.ingest(tabB, {
        type: 'tool_call',
        toolName: 'Edit',
        toolId: 'tool-b-1',
        index: 0,
      } as NormalizedEvent)

      ingestion.ingest(tabA, {
        type: 'tool_call_update',
        toolId: 'tool-a-1',
        partialInput: '{"file_path": "alpha/src/main.ts"}',
      } as NormalizedEvent)

      ingestion.ingest(tabB, {
        type: 'tool_call_update',
        toolId: 'tool-b-1',
        partialInput: '{"path": "beta/src/config.ts", "old_string": "a", "new_string": "b"}',
      } as NormalizedEvent)

      ingestion.ingest(tabA, { type: 'tool_call_complete', index: 0 } as NormalizedEvent)
      ingestion.ingest(tabB, { type: 'tool_call_complete', index: 0 } as NormalizedEvent)

      // Verify each tab's session is in the correct project
      const sessionA = db.db
        .prepare('SELECT project_id FROM sessions WHERE id = ?')
        .get(stateA.sessionId!) as { project_id: string }
      const sessionB = db.db
        .prepare('SELECT project_id FROM sessions WHERE id = ?')
        .get(stateB.sessionId!) as { project_id: string }

      expect(sessionA.project_id).toBe(stateA.projectId)
      expect(sessionB.project_id).toBe(stateB.projectId)

      // Verify events don't leak: Tab A's session should only have Tab A's events
      const eventsA = db.db
        .prepare(
          "SELECT payload_json FROM events WHERE session_id = ? AND event_type = 'tool_call' AND deleted_at IS NULL",
        )
        .all(stateA.sessionId!) as Array<{ payload_json: string }>

      const eventsB = db.db
        .prepare(
          "SELECT payload_json FROM events WHERE session_id = ? AND event_type = 'tool_call' AND deleted_at IS NULL",
        )
        .all(stateB.sessionId!) as Array<{ payload_json: string }>

      expect(eventsA.length).toBe(1)
      expect(eventsB.length).toBe(1)
      expect(JSON.parse(eventsA[0].payload_json).toolName).toBe('Read')
      expect(JSON.parse(eventsB[0].payload_json).toolName).toBe('Edit')

      // Verify messages don't leak
      const msgsA = db.db
        .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user'")
        .all(stateA.sessionId!) as Array<{ content: string }>
      const msgsB = db.db
        .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user'")
        .all(stateB.sessionId!) as Array<{ content: string }>

      expect(msgsA.length).toBe(1)
      expect(msgsA[0].content).toBe('Fix alpha bug')
      expect(msgsB.length).toBe(1)
      expect(msgsB[0].content).toBe('Fix beta bug')

      // Verify files_touched don't leak
      const filesA = db.db
        .prepare('SELECT path FROM files_touched WHERE session_id = ? AND deleted_at IS NULL')
        .all(stateA.sessionId!) as Array<{ path: string }>
      const filesB = db.db
        .prepare('SELECT path FROM files_touched WHERE session_id = ? AND deleted_at IS NULL')
        .all(stateB.sessionId!) as Array<{ path: string }>

      for (const f of filesA) {
        expect(f.path).not.toContain('beta')
      }
      for (const f of filesB) {
        expect(f.path).not.toContain('alpha')
      }
    })
  })

  // ── 5. Degraded mode recovery ───────────────────────────────────────

  describe('degraded mode recovery', () => {
    it('ignores events during degraded period and processes them after cooldown', () => {
      const tabId = 'tab-degraded'
      const projectPath = '/home/user/degraded-project'

      ingestion.initTab(tabId, projectPath)
      ingestion.ensureSession(tabId, projectPath)
      const state = ingestion._getTabState(tabId)!
      const sessionId = state.sessionId!

      // Force degraded mode: set consecutive errors past threshold
      ingestion._setConsecutiveErrors(3)
      // Set degradedUntil to 100ms in the future (we'll wait it out)
      ingestion._setDegradedUntil(Date.now() + 100)

      // Attempt to ingest during degraded period — should be ignored
      ingestion.ingestUserMessage(tabId, 'req-deg-1', 'This should be ignored', [])

      const msgsWhileDegraded = db.db
        .prepare(
          "SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND content = 'This should be ignored'",
        )
        .get(sessionId) as { c: number }
      expect(msgsWhileDegraded.c).toBe(0)

      // Events via ingest() should also be ignored
      ingestion.ingest(tabId, {
        type: 'tool_call',
        toolName: 'Read',
        toolId: 'tool-deg-1',
        index: 0,
      } as NormalizedEvent)

      const eventsWhileDegraded = db.db
        .prepare('SELECT COUNT(*) as c FROM events WHERE session_id = ?')
        .get(sessionId) as { c: number }
      expect(eventsWhileDegraded.c).toBe(0)

      // Set degradedUntil to the past to simulate cooldown expiry
      ingestion._setDegradedUntil(Date.now() - 1000)

      // Now ingestion should work again
      ingestion.ingestUserMessage(tabId, 'req-deg-2', 'This should work', [])

      const msgsAfterRecovery = db.db
        .prepare(
          "SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND content = 'This should work'",
        )
        .get(sessionId) as { c: number }
      expect(msgsAfterRecovery.c).toBe(1)

      // Events via ingest() should also work now
      ingestion.ingest(tabId, {
        type: 'tool_call',
        toolName: 'Edit',
        toolId: 'tool-deg-2',
        index: 0,
      } as NormalizedEvent)

      const eventsAfterRecovery = db.db
        .prepare('SELECT COUNT(*) as c FROM events WHERE session_id = ?')
        .get(sessionId) as { c: number }
      expect(eventsAfterRecovery.c).toBe(1)
    })
  })

  // ── 6. Session lifecycle: idle -> running -> completed -> cleanup ────

  describe('session lifecycle: idle -> running -> completed -> new session', () => {
    it('tracks full lifecycle from tab init through close', () => {
      const tabId = 'tab-lifecycle'
      const projectPath = '/home/user/lifecycle-project'

      // ── Tab init -> session created (idle/active) ────────────────────
      ingestion.initTab(tabId, projectPath)
      ingestion.ensureSession(tabId, projectPath)

      const state = ingestion._getTabState(tabId)!
      const sessionId = state.sessionId!

      // Session should exist with 'active' status
      const initRow = db.db
        .prepare('SELECT status, started_at, ended_at FROM sessions WHERE id = ?')
        .get(sessionId) as { status: string; started_at: string; ended_at: string | null }
      expect(initRow.status).toBe('active')
      expect(initRow.started_at).toBeTruthy()
      expect(initRow.ended_at).toBeNull()

      // ── User message -> persisted (simulates running) ────────────────
      ingestion.ingestUserMessage(tabId, 'req-lc-1', 'Create a new feature', [])

      const userMsgs = db.db
        .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user'")
        .all(sessionId) as Array<{ content: string }>
      expect(userMsgs.length).toBe(1)
      expect(userMsgs[0].content).toBe('Create a new feature')

      // Simulate some assistant work
      ingestion.ingest(tabId, { type: 'text_chunk', text: 'Working on it...' } as NormalizedEvent)
      ingestion.ingest(tabId, {
        type: 'tool_call',
        toolName: 'Write',
        toolId: 'tool-lc-1',
        index: 0,
      } as NormalizedEvent)
      ingestion.ingest(tabId, {
        type: 'tool_call_update',
        toolId: 'tool-lc-1',
        partialInput: '{"file_path": "src/feature.ts", "content": "export const feature = true;"}',
      } as NormalizedEvent)
      ingestion.ingest(tabId, {
        type: 'tool_call_complete',
        index: 0,
      } as NormalizedEvent)

      // ── task_complete -> session completed ────────────────────────────
      ingestion.ingest(tabId, {
        type: 'task_complete',
        result: 'Feature created',
        costUsd: 0.02,
        durationMs: 10000,
        numTurns: 2,
        usage: { input_tokens: 300, output_tokens: 100 },
        sessionId: 'claude-lc-1',
      } as NormalizedEvent)

      const completedRow = db.db
        .prepare('SELECT status, ended_at FROM sessions WHERE id = ?')
        .get(sessionId) as { status: string; ended_at: string | null }
      expect(completedRow.status).toBe('completed')
      expect(completedRow.ended_at).not.toBeNull()

      // ── Tab closed -> cleanup ────────────────────────────────────────
      ingestion.onTabClosed(tabId)

      // Tab state should be cleaned up
      expect(ingestion._getTabState(tabId)).toBeUndefined()

      // ── Verify final DB state ────────────────────────────────────────

      // Session is still 'completed' (not changed to 'abandoned' because it was already completed)
      const finalSessionRow = db.db
        .prepare('SELECT status FROM sessions WHERE id = ?')
        .get(sessionId) as { status: string }
      expect(finalSessionRow.status).toBe('completed')

      // Messages persisted
      const allMsgs = db.db
        .prepare('SELECT role, content FROM messages WHERE session_id = ? AND deleted_at IS NULL ORDER BY seq_num')
        .all(sessionId) as Array<{ role: string; content: string }>
      expect(allMsgs.length).toBeGreaterThanOrEqual(2) // user + at least one assistant

      // Events persisted
      const allEvents = db.db
        .prepare('SELECT event_type FROM events WHERE session_id = ? AND deleted_at IS NULL ORDER BY seq_num')
        .all(sessionId) as Array<{ event_type: string }>
      expect(allEvents.length).toBeGreaterThanOrEqual(3) // tool_call + tool_call_complete + task_complete

      // Files touched
      const files = db.db
        .prepare('SELECT path, action FROM files_touched WHERE session_id = ? AND deleted_at IS NULL')
        .all(sessionId) as Array<{ path: string; action: string }>
      const writeFile = files.find((f) => f.action === 'write')
      expect(writeFile).toBeDefined()
      expect(writeFile!.path).toBe('src/feature.ts')

      // Summary exists
      const summaryRow = db.db
        .prepare(
          "SELECT body FROM session_summaries WHERE session_id = ? AND summary_kind = 'technical' AND deleted_at IS NULL",
        )
        .get(sessionId) as { body: string } | undefined
      expect(summaryRow).toBeDefined()
      expect(summaryRow!.body).toContain('Status: completed')

      // Memory exists
      const memoryRow = db.db
        .prepare(
          "SELECT memory_type FROM memories WHERE session_id = ? AND memory_type = 'session_outcome' AND deleted_at IS NULL",
        )
        .get(sessionId) as { memory_type: string } | undefined
      expect(memoryRow).toBeDefined()
    })
  })
})
