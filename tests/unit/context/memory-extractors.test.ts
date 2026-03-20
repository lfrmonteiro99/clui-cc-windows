import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DatabaseService } from '../../../src/main/context/database-service'
import {
  extractFilePatterns,
  extractErrorPatterns,
  extractToolPreferences,
} from '../../../src/main/context/memory-extractors'
import { __initSqlWasm } from '../../__mocks__/better-sqlite3'

beforeAll(async () => {
  await __initSqlWasm()
})

describe('Memory Extractors', () => {
  let tempDir: string
  let db: DatabaseService
  let projectId: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clui-extractors-test-'))
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

  // ── extractFilePatterns ─────────────────────────────────────────────

  describe('extractFilePatterns', () => {
    it('creates file_pattern memory when file touched >= 5 times across >= 2 sessions', () => {
      const session1 = db.createSession(projectId)
      const session2 = db.createSession(projectId)

      // 3 touches in session1, 2 in session2 = 5 total across 2 sessions
      db.insertFileTouched(session1, null, 'src/hot-file.ts', 'write')
      db.insertFileTouched(session1, null, 'src/hot-file.ts', 'patch')
      db.insertFileTouched(session1, null, 'src/hot-file.ts', 'read')
      db.insertFileTouched(session2, null, 'src/hot-file.ts', 'write')
      db.insertFileTouched(session2, null, 'src/hot-file.ts', 'patch')

      extractFilePatterns(db, projectId, session2)

      const memories = db.db
        .prepare(
          `SELECT memory_type, title, body, importance_score FROM memories
           WHERE project_id = ? AND memory_type = 'file_pattern' AND deleted_at IS NULL`,
        )
        .all(projectId) as Array<{
        memory_type: string
        title: string
        body: string
        importance_score: number
      }>

      expect(memories.length).toBe(1)
      expect(memories[0].title).toBe('src/hot-file.ts')
      expect(memories[0].body).toContain('5 touches')
      expect(memories[0].body).toContain('2 sessions')
      // importance = min(0.9, 0.5 + 5 * 0.02) = 0.6
      expect(memories[0].importance_score).toBeCloseTo(0.6, 2)
    })

    it('does NOT create memory for low-frequency files', () => {
      const session1 = db.createSession(projectId)
      const session2 = db.createSession(projectId)

      // Only 3 touches across 2 sessions — below threshold of 5
      db.insertFileTouched(session1, null, 'src/rare.ts', 'write')
      db.insertFileTouched(session1, null, 'src/rare.ts', 'read')
      db.insertFileTouched(session2, null, 'src/rare.ts', 'patch')

      extractFilePatterns(db, projectId, session2)

      const count = db.db
        .prepare(
          `SELECT COUNT(*) as c FROM memories
           WHERE project_id = ? AND memory_type = 'file_pattern' AND deleted_at IS NULL`,
        )
        .get(projectId) as { c: number }

      expect(count.c).toBe(0)
    })

    it('does NOT create memory when touches are in only 1 session', () => {
      const session1 = db.createSession(projectId)

      // 5 touches but all in 1 session — below session_count threshold of 2
      for (let i = 0; i < 5; i++) {
        db.insertFileTouched(session1, null, 'src/single-session.ts', 'write')
      }

      extractFilePatterns(db, projectId, session1)

      const count = db.db
        .prepare(
          `SELECT COUNT(*) as c FROM memories
           WHERE project_id = ? AND memory_type = 'file_pattern' AND deleted_at IS NULL`,
        )
        .get(projectId) as { c: number }

      expect(count.c).toBe(0)
    })

    it('supersedes existing file_pattern memory with updated stats', () => {
      const session1 = db.createSession(projectId)
      const session2 = db.createSession(projectId)
      const session3 = db.createSession(projectId)

      // First: create 5 touches across 2 sessions
      for (let i = 0; i < 3; i++) {
        db.insertFileTouched(session1, null, 'src/evolving.ts', 'write')
      }
      db.insertFileTouched(session2, null, 'src/evolving.ts', 'patch')
      db.insertFileTouched(session2, null, 'src/evolving.ts', 'read')

      extractFilePatterns(db, projectId, session2)

      // Verify initial memory
      const initial = db.db
        .prepare(
          `SELECT id, body FROM memories
           WHERE project_id = ? AND memory_type = 'file_pattern' AND deleted_at IS NULL`,
        )
        .get(projectId) as { id: string; body: string }
      expect(initial).toBeDefined()
      expect(initial.body).toContain('5 touches')

      // Add more touches in session3
      db.insertFileTouched(session3, null, 'src/evolving.ts', 'write')
      db.insertFileTouched(session3, null, 'src/evolving.ts', 'patch')

      extractFilePatterns(db, projectId, session3)

      // Original should be soft-deleted
      const oldRow = db.db
        .prepare('SELECT deleted_at FROM memories WHERE id = ?')
        .get(initial.id) as { deleted_at: string | null }
      expect(oldRow.deleted_at).not.toBeNull()

      // New memory should exist with updated stats
      const updated = db.db
        .prepare(
          `SELECT body, supersedes_memory_id FROM memories
           WHERE project_id = ? AND memory_type = 'file_pattern' AND deleted_at IS NULL`,
        )
        .get(projectId) as { body: string; supersedes_memory_id: string }
      expect(updated.body).toContain('7 touches')
      expect(updated.body).toContain('3 sessions')
      expect(updated.supersedes_memory_id).toBe(initial.id)
    })

    it('caps importance score at 0.9', () => {
      const session1 = db.createSession(projectId)
      const session2 = db.createSession(projectId)

      // 30 touches — would compute 0.5 + 30*0.02 = 1.1, but capped at 0.9
      for (let i = 0; i < 20; i++) {
        db.insertFileTouched(session1, null, 'src/mega-hot.ts', 'write')
      }
      for (let i = 0; i < 10; i++) {
        db.insertFileTouched(session2, null, 'src/mega-hot.ts', 'patch')
      }

      extractFilePatterns(db, projectId, session2)

      const memory = db.db
        .prepare(
          `SELECT importance_score FROM memories
           WHERE project_id = ? AND memory_type = 'file_pattern' AND deleted_at IS NULL`,
        )
        .get(projectId) as { importance_score: number }

      expect(memory.importance_score).toBe(0.9)
    })
  })

  // ── extractErrorPatterns ────────────────────────────────────────────

  describe('extractErrorPatterns', () => {
    it('creates error_pattern memory for errors occurring >= 3 times', () => {
      const session1 = db.createSession(projectId)
      const session2 = db.createSession(projectId)

      // Insert 3 error events with the same message
      const errorPayload = JSON.stringify({ message: 'TypeError: Cannot read property x of undefined' })
      db.insertEvent(session1, 'error', errorPayload, 1)
      db.insertEvent(session1, 'error', errorPayload, 2)
      db.insertEvent(session2, 'error', errorPayload, 1)

      extractErrorPatterns(db, projectId, session2)

      const memories = db.db
        .prepare(
          `SELECT memory_type, title, body, importance_score FROM memories
           WHERE project_id = ? AND memory_type = 'error_pattern' AND deleted_at IS NULL`,
        )
        .all(projectId) as Array<{
        memory_type: string
        title: string
        body: string
        importance_score: number
      }>

      expect(memories.length).toBe(1)
      expect(memories[0].title).toBe('TypeError: Cannot read property x of undefined')
      expect(memories[0].body).toContain('3 occurrences')
      // importance = min(0.8, 0.4 + 3*0.05) = 0.55
      expect(memories[0].importance_score).toBeCloseTo(0.55, 2)
    })

    it('does NOT create memory for infrequent errors', () => {
      const session1 = db.createSession(projectId)

      // Only 2 errors — below threshold of 3
      const errorPayload = JSON.stringify({ message: 'Rare error' })
      db.insertEvent(session1, 'error', errorPayload, 1)
      db.insertEvent(session1, 'error', errorPayload, 2)

      extractErrorPatterns(db, projectId, session1)

      const count = db.db
        .prepare(
          `SELECT COUNT(*) as c FROM memories
           WHERE project_id = ? AND memory_type = 'error_pattern' AND deleted_at IS NULL`,
        )
        .get(projectId) as { c: number }

      expect(count.c).toBe(0)
    })

    it('supersedes existing error_pattern memory with updated count', () => {
      const session1 = db.createSession(projectId)
      const session2 = db.createSession(projectId)

      const errorPayload = JSON.stringify({ message: 'Recurring failure' })
      db.insertEvent(session1, 'error', errorPayload, 1)
      db.insertEvent(session1, 'error', errorPayload, 2)
      db.insertEvent(session1, 'error', errorPayload, 3)

      extractErrorPatterns(db, projectId, session1)

      const initial = db.db
        .prepare(
          `SELECT id, body FROM memories
           WHERE project_id = ? AND memory_type = 'error_pattern' AND deleted_at IS NULL`,
        )
        .get(projectId) as { id: string; body: string }
      expect(initial.body).toContain('3 occurrences')

      // Add more errors
      db.insertEvent(session2, 'error', errorPayload, 1)
      db.insertEvent(session2, 'error', errorPayload, 2)

      extractErrorPatterns(db, projectId, session2)

      // Old should be superseded
      const oldRow = db.db
        .prepare('SELECT deleted_at FROM memories WHERE id = ?')
        .get(initial.id) as { deleted_at: string | null }
      expect(oldRow.deleted_at).not.toBeNull()

      // New should have updated count
      const updated = db.db
        .prepare(
          `SELECT body FROM memories
           WHERE project_id = ? AND memory_type = 'error_pattern' AND deleted_at IS NULL`,
        )
        .get(projectId) as { body: string }
      expect(updated.body).toContain('5 occurrences')
    })

    it('truncates long error messages in title to 100 chars', () => {
      const session1 = db.createSession(projectId)

      const longMessage = 'A'.repeat(200)
      const errorPayload = JSON.stringify({ message: longMessage })
      db.insertEvent(session1, 'error', errorPayload, 1)
      db.insertEvent(session1, 'error', errorPayload, 2)
      db.insertEvent(session1, 'error', errorPayload, 3)

      extractErrorPatterns(db, projectId, session1)

      const memory = db.db
        .prepare(
          `SELECT title FROM memories
           WHERE project_id = ? AND memory_type = 'error_pattern' AND deleted_at IS NULL`,
        )
        .get(projectId) as { title: string }

      expect(memory.title.length).toBe(100)
    })

    it('caps importance score at 0.8', () => {
      const session1 = db.createSession(projectId)

      // 20 errors — would compute 0.4 + 20*0.05 = 1.4, but capped at 0.8
      const errorPayload = JSON.stringify({ message: 'Frequent error' })
      for (let i = 0; i < 20; i++) {
        db.insertEvent(session1, 'error', errorPayload, i + 1)
      }

      extractErrorPatterns(db, projectId, session1)

      const memory = db.db
        .prepare(
          `SELECT importance_score FROM memories
           WHERE project_id = ? AND memory_type = 'error_pattern' AND deleted_at IS NULL`,
        )
        .get(projectId) as { importance_score: number }

      expect(memory.importance_score).toBe(0.8)
    })
  })

  // ── extractToolPreferences ──────────────────────────────────────────

  describe('extractToolPreferences', () => {
    it('creates tool_preference distribution memory', () => {
      const session1 = db.createSession(projectId)

      // Insert tool_call events with toolName in payload
      db.insertEvent(session1, 'tool_call', JSON.stringify({ toolName: 'Read' }), 1)
      db.insertEvent(session1, 'tool_call', JSON.stringify({ toolName: 'Read' }), 2)
      db.insertEvent(session1, 'tool_call', JSON.stringify({ toolName: 'Edit' }), 3)
      db.insertEvent(session1, 'tool_call', JSON.stringify({ toolName: 'Bash' }), 4)

      extractToolPreferences(db, projectId, session1)

      const memories = db.db
        .prepare(
          `SELECT title, body, importance_score FROM memories
           WHERE project_id = ? AND memory_type = 'tool_preference' AND deleted_at IS NULL`,
        )
        .all(projectId) as Array<{
        title: string
        body: string
        importance_score: number
      }>

      expect(memories.length).toBe(1)
      expect(memories[0].title).toBe('Tool usage distribution')
      expect(memories[0].body).toContain('4 total calls')
      expect(memories[0].body).toContain('Read 50%')
      expect(memories[0].importance_score).toBe(0.4)
    })

    it('does nothing when no tool_call events exist', () => {
      const session1 = db.createSession(projectId)

      extractToolPreferences(db, projectId, session1)

      const count = db.db
        .prepare(
          `SELECT COUNT(*) as c FROM memories
           WHERE project_id = ? AND memory_type = 'tool_preference' AND deleted_at IS NULL`,
        )
        .get(projectId) as { c: number }

      expect(count.c).toBe(0)
    })

    it('supersedes existing tool_preference memory', () => {
      const session1 = db.createSession(projectId)
      const session2 = db.createSession(projectId)

      db.insertEvent(session1, 'tool_call', JSON.stringify({ toolName: 'Read' }), 1)
      db.insertEvent(session1, 'tool_call', JSON.stringify({ toolName: 'Read' }), 2)

      extractToolPreferences(db, projectId, session1)

      const initial = db.db
        .prepare(
          `SELECT id, body FROM memories
           WHERE project_id = ? AND memory_type = 'tool_preference' AND deleted_at IS NULL`,
        )
        .get(projectId) as { id: string; body: string }
      expect(initial.body).toContain('2 total calls')

      // Add more tool calls
      db.insertEvent(session2, 'tool_call', JSON.stringify({ toolName: 'Bash' }), 1)
      db.insertEvent(session2, 'tool_call', JSON.stringify({ toolName: 'Bash' }), 2)
      db.insertEvent(session2, 'tool_call', JSON.stringify({ toolName: 'Bash' }), 3)

      extractToolPreferences(db, projectId, session2)

      // Old should be superseded
      const oldRow = db.db
        .prepare('SELECT deleted_at FROM memories WHERE id = ?')
        .get(initial.id) as { deleted_at: string | null }
      expect(oldRow.deleted_at).not.toBeNull()

      // New should have updated distribution
      const updated = db.db
        .prepare(
          `SELECT body, supersedes_memory_id FROM memories
           WHERE project_id = ? AND memory_type = 'tool_preference' AND deleted_at IS NULL`,
        )
        .get(projectId) as { body: string; supersedes_memory_id: string }
      expect(updated.body).toContain('5 total calls')
      expect(updated.body).toContain('Bash 60%')
      expect(updated.supersedes_memory_id).toBe(initial.id)
    })

    it('limits distribution to top 5 tools', () => {
      const session1 = db.createSession(projectId)

      // 7 different tools
      const tools = ['Read', 'Edit', 'Bash', 'Write', 'MultiEdit', 'Grep', 'Glob']
      for (let i = 0; i < tools.length; i++) {
        db.insertEvent(
          session1,
          'tool_call',
          JSON.stringify({ toolName: tools[i] }),
          i + 1,
        )
      }

      extractToolPreferences(db, projectId, session1)

      const memory = db.db
        .prepare(
          `SELECT body FROM memories
           WHERE project_id = ? AND memory_type = 'tool_preference' AND deleted_at IS NULL`,
        )
        .get(projectId) as { body: string }

      // Distribution string should only contain 5 entries
      // Each entry looks like "ToolName XX%"
      const percentMatches = memory.body.match(/\d+%/g)
      expect(percentMatches).not.toBeNull()
      expect(percentMatches!.length).toBeLessThanOrEqual(5)
    })
  })
})
