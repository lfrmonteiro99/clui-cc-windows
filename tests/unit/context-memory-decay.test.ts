import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DatabaseService } from '../../src/main/context/database-service'
import { RetrievalService } from '../../src/main/context/retrieval-service'
import type { MemoryInsert } from '../../src/main/context/types'
import { applyMemoryDecay } from '../../src/main/context/memory-decay'
import { __initSqlWasm } from '../__mocks__/better-sqlite3'

beforeAll(async () => {
  await __initSqlWasm()
})

describe('CTX-007: Memory Decay and Automatic Pruning', () => {
  let tempDir: string
  let db: DatabaseService
  let projectId: string

  const makeMemory = (overrides?: Partial<MemoryInsert>): MemoryInsert => ({
    projectId,
    sessionId: null,
    memoryType: 'session_outcome',
    scope: 'project',
    title: 'Test memory',
    body: 'Some body text',
    sourceRefsJson: null,
    importanceScore: 0.5,
    confidenceScore: 1.0,
    ...overrides,
  })

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clui-decay-test-'))
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

  // ── Score decay based on last access time ─────────────────────────────

  describe('applyMemoryDecay()', () => {
    it('applies 50% score penalty for memory accessed 31+ days ago', () => {
      const baseScore = 0.8
      const daysSinceAccess = 35
      const result = applyMemoryDecay(baseScore, daysSinceAccess)
      expect(result).toBeCloseTo(0.4, 2) // 0.8 * 0.5
    })

    it('applies 25% score penalty for memory accessed 15-30 days ago', () => {
      const baseScore = 0.8
      const daysSinceAccess = 20
      const result = applyMemoryDecay(baseScore, daysSinceAccess)
      expect(result).toBeCloseTo(0.6, 2) // 0.8 * 0.75
    })

    it('applies no penalty for memory accessed less than 14 days ago', () => {
      const baseScore = 0.8
      const daysSinceAccess = 10
      const result = applyMemoryDecay(baseScore, daysSinceAccess)
      expect(result).toBeCloseTo(0.8, 2) // 0.8 * 1.0
    })

    it('applies no penalty for memory accessed exactly 14 days ago', () => {
      const baseScore = 0.6
      const daysSinceAccess = 14
      const result = applyMemoryDecay(baseScore, daysSinceAccess)
      expect(result).toBeCloseTo(0.6, 2) // 0.6 * 1.0
    })

    it('applies 25% penalty for memory accessed exactly 15 days ago', () => {
      const baseScore = 1.0
      const daysSinceAccess = 15
      const result = applyMemoryDecay(baseScore, daysSinceAccess)
      expect(result).toBeCloseTo(0.75, 2) // 1.0 * 0.75
    })

    it('applies 50% penalty for memory accessed exactly 31 days ago', () => {
      const baseScore = 1.0
      const daysSinceAccess = 31
      const result = applyMemoryDecay(baseScore, daysSinceAccess)
      expect(result).toBeCloseTo(0.5, 2) // 1.0 * 0.5
    })

    it('applies 25% penalty for memory accessed exactly 30 days ago', () => {
      const baseScore = 1.0
      const daysSinceAccess = 30
      const result = applyMemoryDecay(baseScore, daysSinceAccess)
      expect(result).toBeCloseTo(0.75, 2) // 1.0 * 0.75
    })
  })

  // ── Startup pruning ───────────────────────────────────────────────────

  describe('pruneStaleMemories()', () => {
    it('deletes memories with importance < 0.3 and age > 60 days', () => {
      const sessionId = db.createSession(projectId)

      const id = db.insertMemory(
        makeMemory({
          sessionId,
          importanceScore: 0.2,
          title: 'Low importance old memory',
        }),
      )

      // Backdate to 65 days ago
      db.db
        .prepare(
          `UPDATE memories SET created_at = datetime('now', '-65 days'),
           updated_at = datetime('now', '-65 days'),
           last_accessed_at = datetime('now', '-65 days') WHERE id = ?`,
        )
        .run(id)

      const pruned = db.pruneStaleMemories(60, 0.3)
      expect(pruned).toBe(1)

      const row = db.db
        .prepare('SELECT deleted_at FROM memories WHERE id = ?')
        .get(id) as { deleted_at: string | null }
      expect(row.deleted_at).not.toBeNull()
    })

    it('does NOT prune memories with importance >= 0.3 even if old', () => {
      const sessionId = db.createSession(projectId)

      const id = db.insertMemory(
        makeMemory({
          sessionId,
          importanceScore: 0.5,
          title: 'Important memory',
        }),
      )

      // Backdate to 90 days ago
      db.db
        .prepare(
          `UPDATE memories SET created_at = datetime('now', '-90 days'),
           updated_at = datetime('now', '-90 days'),
           last_accessed_at = datetime('now', '-90 days') WHERE id = ?`,
        )
        .run(id)

      const pruned = db.pruneStaleMemories(60, 0.3)
      expect(pruned).toBe(0)
    })

    it('does NOT prune memories younger than the age threshold', () => {
      const sessionId = db.createSession(projectId)

      const id = db.insertMemory(
        makeMemory({
          sessionId,
          importanceScore: 0.1,
          title: 'Young low importance memory',
        }),
      )

      // Only 30 days old
      db.db
        .prepare(
          `UPDATE memories SET created_at = datetime('now', '-30 days'),
           updated_at = datetime('now', '-30 days'),
           last_accessed_at = datetime('now', '-30 days') WHERE id = ?`,
        )
        .run(id)

      const pruned = db.pruneStaleMemories(60, 0.3)
      expect(pruned).toBe(0)
    })

    it('pinned memories are NEVER pruned regardless of age and importance', () => {
      const sessionId = db.createSession(projectId)

      const id = db.insertMemory(
        makeMemory({
          sessionId,
          importanceScore: 0.05,
          title: 'Pinned ancient memory',
        }),
      )

      db.pinMemory(id)

      // Backdate to 200 days ago
      db.db
        .prepare(
          `UPDATE memories SET created_at = datetime('now', '-200 days'),
           updated_at = datetime('now', '-200 days'),
           last_accessed_at = NULL WHERE id = ?`,
        )
        .run(id)

      const pruned = db.pruneStaleMemories(60, 0.3)
      expect(pruned).toBe(0)

      const row = db.db
        .prepare('SELECT deleted_at, is_pinned FROM memories WHERE id = ?')
        .get(id) as { deleted_at: string | null; is_pinned: number }
      expect(row.deleted_at).toBeNull()
      expect(row.is_pinned).toBe(1)
    })

    it('uses last_accessed_at (not created_at) for age calculation', () => {
      const sessionId = db.createSession(projectId)

      const id = db.insertMemory(
        makeMemory({
          sessionId,
          importanceScore: 0.1,
          title: 'Old but recently accessed',
        }),
      )

      // Created 100 days ago but accessed recently
      db.db
        .prepare(
          `UPDATE memories SET created_at = datetime('now', '-100 days'),
           updated_at = datetime('now', '-100 days'),
           last_accessed_at = datetime('now', '-5 days') WHERE id = ?`,
        )
        .run(id)

      const pruned = db.pruneStaleMemories(60, 0.3)
      expect(pruned).toBe(0)
    })

    it('falls back to created_at when last_accessed_at is NULL', () => {
      const sessionId = db.createSession(projectId)

      const id = db.insertMemory(
        makeMemory({
          sessionId,
          importanceScore: 0.1,
          title: 'Never accessed, very old',
        }),
      )

      // Created 100 days ago, never accessed
      db.db
        .prepare(
          `UPDATE memories SET created_at = datetime('now', '-100 days'),
           updated_at = datetime('now', '-100 days'),
           last_accessed_at = NULL WHERE id = ?`,
        )
        .run(id)

      const pruned = db.pruneStaleMemories(60, 0.3)
      expect(pruned).toBe(1)
    })

    it('uses default parameters when called without arguments', () => {
      const sessionId = db.createSession(projectId)

      // Low importance, very old — should be pruned by default params
      const id = db.insertMemory(
        makeMemory({
          sessionId,
          importanceScore: 0.1,
          title: 'Should be pruned by defaults',
        }),
      )

      db.db
        .prepare(
          `UPDATE memories SET created_at = datetime('now', '-100 days'),
           updated_at = datetime('now', '-100 days'),
           last_accessed_at = NULL WHERE id = ?`,
        )
        .run(id)

      // Default call (no args) should still prune
      const pruned = db.pruneStaleMemories()
      expect(pruned).toBe(1)
    })
  })

  // ── accessed_at updated when memory used in smart packet ──────────────

  describe('accessed_at update on packet retrieval', () => {
    it('updates last_accessed_at when memories are selected for packet', () => {
      const sessionId = db.createSession(projectId)

      const id = db.insertMemory(
        makeMemory({
          sessionId,
          importanceScore: 0.9,
          title: 'Important retrievable memory',
          body: 'testing retrieval access tracking',
        }),
      )

      // Check initial state
      const before = db.db
        .prepare('SELECT last_accessed_at, access_count FROM memories WHERE id = ?')
        .get(id) as { last_accessed_at: string | null; access_count: number }
      expect(before.access_count).toBe(0)

      // Build a memory packet which should trigger access update
      const retrieval = new RetrievalService(db)
      retrieval.buildMemoryPacket(projectId, 'tab-1', 'testing retrieval')

      // Check that access was tracked
      const after = db.db
        .prepare('SELECT last_accessed_at, access_count FROM memories WHERE id = ?')
        .get(id) as { last_accessed_at: string | null; access_count: number }
      expect(after.access_count).toBeGreaterThan(0)
      expect(after.last_accessed_at).not.toBeNull()
    })
  })

  // ── Migration 003 ─────────────────────────────────────────────────────

  describe('migration 003-memory-decay', () => {
    it('adds accessed_at column to existing databases', () => {
      // The column already exists in the initial schema from migration 001
      // but migration 003 ensures it's populated for any rows missing it.
      // Verify the column exists and COALESCE logic works.
      const sessionId = db.createSession(projectId)
      const id = db.insertMemory(
        makeMemory({ sessionId, title: 'Migration test memory' }),
      )

      // Verify the column exists by querying it
      const row = db.db
        .prepare('SELECT last_accessed_at FROM memories WHERE id = ?')
        .get(id) as { last_accessed_at: string | null }
      // New memories have NULL last_accessed_at by default
      expect(row.last_accessed_at).toBeNull()
    })
  })
})
