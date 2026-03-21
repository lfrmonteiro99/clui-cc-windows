import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DatabaseService } from '../../../src/main/context/database-service'
import { IngestionService } from '../../../src/main/context/ingestion-service'
import { extractFilePatterns } from '../../../src/main/context/memory-extractors'
import type { MemoryInsert } from '../../../src/main/context/types'
import { __initSqlWasm } from '../../__mocks__/better-sqlite3'

beforeAll(async () => {
  await __initSqlWasm()
})

/**
 * Integration tests for the pruning + pinning lifecycle.
 *
 * The core pruneStaleMemories logic is already tested in database-service.test.ts.
 * These tests focus on:
 * - Interaction between pruning and extractor-created memories
 * - Pinning protection across memory types
 * - End-to-end: extractor creates memory, pruning skips/removes it
 */
describe('Pruning + Pinning Lifecycle', () => {
  let tempDir: string
  let db: DatabaseService
  let projectId: string

  const makeMemory = (overrides?: Partial<MemoryInsert>): MemoryInsert => ({
    projectId,
    sessionId: null,
    memoryType: 'session_outcome',
    scope: 'project',
    title: 'Test memory',
    body: 'Some body',
    sourceRefsJson: null,
    importanceScore: 0.5,
    confidenceScore: 1.0,
    ...overrides,
  })

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clui-pruning-test-'))
    const dbPath = join(tempDir, 'test.sqlite')
    const blobsPath = join(tempDir, 'blobs')
    db = new DatabaseService(dbPath, blobsPath)
    db.init()
    projectId = db.upsertProject('/home/user/project', 'test-project')
  })

  afterEach(() => {
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ── Core pruning criteria (integration confirmation) ────────────────

  it('prunes memories with low importance + old age + not pinned', () => {
    const sessionId = db.createSession(projectId)

    const id = db.insertMemory(
      makeMemory({
        sessionId,
        memoryType: 'file_pattern',
        importanceScore: 0.1,
        title: 'Stale file pattern',
      }),
    )

    // Backdate to 100 days ago
    db.db
      .prepare(
        `UPDATE memories SET created_at = datetime('now', '-100 days'),
         updated_at = datetime('now', '-100 days') WHERE id = ?`,
      )
      .run(id)

    const pruned = db.pruneStaleMemories()
    expect(pruned).toBe(1)

    const row = db.db
      .prepare('SELECT deleted_at FROM memories WHERE id = ?')
      .get(id) as { deleted_at: string | null }
    expect(row.deleted_at).not.toBeNull()
  })

  it('does NOT prune pinned memories regardless of age/importance', () => {
    const sessionId = db.createSession(projectId)

    const id = db.insertMemory(
      makeMemory({
        sessionId,
        memoryType: 'error_pattern',
        importanceScore: 0.05,
        title: 'Pinned old error',
      }),
    )

    db.pinMemory(id)

    // Backdate
    db.db
      .prepare(
        `UPDATE memories SET created_at = datetime('now', '-200 days'),
         updated_at = datetime('now', '-200 days'),
         last_accessed_at = NULL WHERE id = ?`,
      )
      .run(id)

    const pruned = db.pruneStaleMemories()
    expect(pruned).toBe(0)

    // Verify still alive
    const row = db.db
      .prepare('SELECT deleted_at, is_pinned FROM memories WHERE id = ?')
      .get(id) as { deleted_at: string | null; is_pinned: number }
    expect(row.deleted_at).toBeNull()
    expect(row.is_pinned).toBe(1)
  })

  it('does NOT prune recent memories regardless of importance', () => {
    const sessionId = db.createSession(projectId)

    const id = db.insertMemory(
      makeMemory({
        sessionId,
        memoryType: 'tool_preference',
        importanceScore: 0.05,
        title: 'Fresh low-importance memory',
      }),
    )

    // Not backdated — created_at is "now"
    const pruned = db.pruneStaleMemories()
    expect(pruned).toBe(0)

    const row = db.db
      .prepare('SELECT deleted_at FROM memories WHERE id = ?')
      .get(id) as { deleted_at: string | null }
    expect(row.deleted_at).toBeNull()
  })

  it('does NOT prune high-importance memories regardless of age', () => {
    const sessionId = db.createSession(projectId)

    const id = db.insertMemory(
      makeMemory({
        sessionId,
        memoryType: 'file_pattern',
        importanceScore: 0.8,
        title: 'Important old file',
      }),
    )

    // Backdate
    db.db
      .prepare(
        `UPDATE memories SET created_at = datetime('now', '-365 days'),
         updated_at = datetime('now', '-365 days') WHERE id = ?`,
      )
      .run(id)

    const pruned = db.pruneStaleMemories()
    expect(pruned).toBe(0)
  })

  // ── Pin/unpin lifecycle ─────────────────────────────────────────────

  it('unpinning a memory makes it eligible for pruning again', () => {
    const sessionId = db.createSession(projectId)

    const id = db.insertMemory(
      makeMemory({
        sessionId,
        importanceScore: 0.05,
        title: 'Will be unpinned',
      }),
    )

    db.pinMemory(id)

    // Backdate
    db.db
      .prepare(
        `UPDATE memories SET created_at = datetime('now', '-100 days'),
         updated_at = datetime('now', '-100 days'),
         last_accessed_at = NULL WHERE id = ?`,
      )
      .run(id)

    // While pinned: not pruned
    expect(db.pruneStaleMemories()).toBe(0)

    // Unpin
    db.unpinMemory(id)

    // Need to also reset updated_at since unpinMemory sets it to now
    db.db
      .prepare(
        `UPDATE memories SET updated_at = datetime('now', '-100 days'),
         last_accessed_at = NULL WHERE id = ?`,
      )
      .run(id)

    // Now eligible for pruning
    expect(db.pruneStaleMemories()).toBe(1)
  })

  // ── Mixed memory types in same prune run ────────────────────────────

  it('prunes selectively across mixed memory types', () => {
    const sessionId = db.createSession(projectId)

    // Stale low-importance file_pattern — should be pruned
    const staleId = db.insertMemory(
      makeMemory({
        sessionId,
        memoryType: 'file_pattern',
        importanceScore: 0.1,
        title: 'Stale file',
      }),
    )
    db.db
      .prepare(
        `UPDATE memories SET created_at = datetime('now', '-100 days'),
         updated_at = datetime('now', '-100 days') WHERE id = ?`,
      )
      .run(staleId)

    // Recent low-importance error_pattern — should NOT be pruned
    db.insertMemory(
      makeMemory({
        sessionId,
        memoryType: 'error_pattern',
        importanceScore: 0.1,
        title: 'Recent error',
      }),
    )

    // Old high-importance session_outcome — should NOT be pruned
    const importantId = db.insertMemory(
      makeMemory({
        sessionId,
        memoryType: 'session_outcome',
        importanceScore: 0.7,
        title: 'Important session',
      }),
    )
    db.db
      .prepare(
        `UPDATE memories SET created_at = datetime('now', '-200 days'),
         updated_at = datetime('now', '-200 days') WHERE id = ?`,
      )
      .run(importantId)

    // Pinned stale tool_preference — should NOT be pruned
    const pinnedId = db.insertMemory(
      makeMemory({
        sessionId,
        memoryType: 'tool_preference',
        importanceScore: 0.05,
        title: 'Pinned tools',
      }),
    )
    db.pinMemory(pinnedId)
    db.db
      .prepare(
        `UPDATE memories SET created_at = datetime('now', '-150 days'),
         updated_at = datetime('now', '-150 days'),
         last_accessed_at = NULL WHERE id = ?`,
      )
      .run(pinnedId)

    const pruned = db.pruneStaleMemories()
    expect(pruned).toBe(1)

    // Only staleId should be deleted
    const staleRow = db.db
      .prepare('SELECT deleted_at FROM memories WHERE id = ?')
      .get(staleId) as { deleted_at: string | null }
    expect(staleRow.deleted_at).not.toBeNull()

    // Others should be alive
    const activeCount = db.db
      .prepare(
        `SELECT COUNT(*) as c FROM memories
         WHERE project_id = ? AND deleted_at IS NULL`,
      )
      .get(projectId) as { c: number }
    expect(activeCount.c).toBe(3)
  })

  // ── Extractor → pruning interaction ─────────────────────────────────

  it('extractor-created memories survive pruning when importance is sufficient', () => {
    const session1 = db.createSession(projectId)
    const session2 = db.createSession(projectId)

    // Create enough file touches to trigger file_pattern extractor
    for (let i = 0; i < 3; i++) {
      db.insertFileTouched(session1, null, 'src/stable.ts', 'write')
    }
    db.insertFileTouched(session2, null, 'src/stable.ts', 'patch')
    db.insertFileTouched(session2, null, 'src/stable.ts', 'read')

    extractFilePatterns(db, projectId, session2)

    // Verify memory exists — importance should be 0.6 (0.5 + 5*0.02)
    const memory = db.db
      .prepare(
        `SELECT id, importance_score FROM memories
         WHERE project_id = ? AND memory_type = 'file_pattern' AND deleted_at IS NULL`,
      )
      .get(projectId) as { id: string; importance_score: number }
    expect(memory.importance_score).toBeCloseTo(0.6, 2)

    // Backdate to 100 days
    db.db
      .prepare(
        `UPDATE memories SET created_at = datetime('now', '-100 days'),
         updated_at = datetime('now', '-100 days') WHERE id = ?`,
      )
      .run(memory.id)

    // Pruning should NOT remove it (importance 0.6 > 0.2 threshold)
    const pruned = db.pruneStaleMemories()
    expect(pruned).toBe(0)
  })

  // ── Ingestion wiring: task_complete runs extractors ─────────────────

  it('task_complete event triggers memory extractors via IngestionService', () => {
    const ingestion = new IngestionService(db)

    const tabId = 'tab-extract'
    ingestion.initTab(tabId, '/home/user/project')
    ingestion.ensureSession(tabId, '/home/user/project')

    const state = ingestion._getTabState(tabId)!
    const sessionId = state.sessionId!

    // Create a second session so file touches span 2 sessions
    const otherSessionId = db.createSession(projectId)

    // Create enough file touches across both sessions to trigger file_pattern
    for (let i = 0; i < 3; i++) {
      db.insertFileTouched(otherSessionId, null, 'src/index.ts', 'write')
    }
    db.insertFileTouched(sessionId, null, 'src/index.ts', 'patch')
    db.insertFileTouched(sessionId, null, 'src/index.ts', 'read')

    // Also create tool_call events to trigger tool_preference
    db.insertEvent(sessionId, 'tool_call', JSON.stringify({ toolName: 'Read' }), 100)
    db.insertEvent(sessionId, 'tool_call', JSON.stringify({ toolName: 'Edit' }), 101)

    // Fire task_complete
    ingestion.ingest(tabId, {
      type: 'task_complete',
      result: 'Done',
      costUsd: 0.01,
      durationMs: 5000,
      numTurns: 1,
      usage: {},
      sessionId: 'claude-sess-1',
    })

    // Should have session_outcome + file_pattern + tool_preference
    const memories = db.db
      .prepare(
        `SELECT memory_type FROM memories
         WHERE project_id = ? AND deleted_at IS NULL
         ORDER BY memory_type`,
      )
      .all(projectId) as Array<{ memory_type: string }>

    const types = memories.map((m) => m.memory_type)
    expect(types).toContain('session_outcome')
    expect(types).toContain('file_pattern')
    expect(types).toContain('tool_preference')

    ingestion.shutdown()
  })
})
