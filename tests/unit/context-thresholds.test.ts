import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DatabaseService } from '../../src/main/context/database-service'
import {
  extractFilePatterns,
  extractErrorPatterns,
  extractToolPreferences,
} from '../../src/main/context/memory-extractors'
import { __initSqlWasm } from '../__mocks__/better-sqlite3'

beforeAll(async () => {
  await __initSqlWasm()
})

describe('CTX-003: Lower memory extraction thresholds', () => {
  let tempDir: string
  let db: DatabaseService
  let projectId: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clui-thresholds-test-'))
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

  // ── file_pattern: lowered from >= 5 touches / >= 2 sessions to >= 3 touches / >= 1 session ──

  describe('file_pattern threshold (>= 3 touches, >= 1 session)', () => {
    it('creates file_pattern memory with 3 touches in 1 session', () => {
      const session1 = db.createSession(projectId)

      db.insertFileTouched(session1, null, 'src/index.ts', 'write')
      db.insertFileTouched(session1, null, 'src/index.ts', 'patch')
      db.insertFileTouched(session1, null, 'src/index.ts', 'read')

      extractFilePatterns(db, projectId, session1)

      const memories = db.db
        .prepare(
          `SELECT memory_type, title, body FROM memories
           WHERE project_id = ? AND memory_type = 'file_pattern' AND deleted_at IS NULL`,
        )
        .all(projectId) as Array<{
        memory_type: string
        title: string
        body: string
      }>

      expect(memories.length).toBe(1)
      expect(memories[0].title).toBe('src/index.ts')
      expect(memories[0].body).toContain('3 touches')
      expect(memories[0].body).toContain('1 sessions')
    })

    it('does NOT create file_pattern memory with only 2 touches', () => {
      const session1 = db.createSession(projectId)

      db.insertFileTouched(session1, null, 'src/rare.ts', 'write')
      db.insertFileTouched(session1, null, 'src/rare.ts', 'read')

      extractFilePatterns(db, projectId, session1)

      const count = db.db
        .prepare(
          `SELECT COUNT(*) as c FROM memories
           WHERE project_id = ? AND memory_type = 'file_pattern' AND deleted_at IS NULL`,
        )
        .get(projectId) as { c: number }

      expect(count.c).toBe(0)
    })
  })

  // ── error_pattern: lowered from >= 3 to >= 2 ──

  describe('error_pattern threshold (>= 2 occurrences)', () => {
    it('creates error_pattern memory with 2 occurrences', () => {
      const session1 = db.createSession(projectId)

      const errorPayload = JSON.stringify({ message: 'ReferenceError: x is not defined' })
      db.insertEvent(session1, 'error', errorPayload, 1)
      db.insertEvent(session1, 'error', errorPayload, 2)

      extractErrorPatterns(db, projectId, session1)

      const memories = db.db
        .prepare(
          `SELECT memory_type, title, body FROM memories
           WHERE project_id = ? AND memory_type = 'error_pattern' AND deleted_at IS NULL`,
        )
        .all(projectId) as Array<{
        memory_type: string
        title: string
        body: string
      }>

      expect(memories.length).toBe(1)
      expect(memories[0].title).toBe('ReferenceError: x is not defined')
      expect(memories[0].body).toContain('2 occurrences')
    })

    it('does NOT create error_pattern memory with only 1 occurrence', () => {
      const session1 = db.createSession(projectId)

      const errorPayload = JSON.stringify({ message: 'One-off error' })
      db.insertEvent(session1, 'error', errorPayload, 1)

      extractErrorPatterns(db, projectId, session1)

      const count = db.db
        .prepare(
          `SELECT COUNT(*) as c FROM memories
           WHERE project_id = ? AND memory_type = 'error_pattern' AND deleted_at IS NULL`,
        )
        .get(projectId) as { c: number }

      expect(count.c).toBe(0)
    })
  })

  // ── tool_preference importance: raised from 0.4 to 0.5 ──

  describe('tool_preference importance (0.5)', () => {
    it('creates tool_preference memory with importance 0.5', () => {
      const session1 = db.createSession(projectId)

      db.insertEvent(session1, 'tool_call', JSON.stringify({ toolName: 'Read' }), 1)
      db.insertEvent(session1, 'tool_call', JSON.stringify({ toolName: 'Edit' }), 2)

      extractToolPreferences(db, projectId, session1)

      const memory = db.db
        .prepare(
          `SELECT importance_score FROM memories
           WHERE project_id = ? AND memory_type = 'tool_preference' AND deleted_at IS NULL`,
        )
        .get(projectId) as { importance_score: number }

      expect(memory).toBeDefined()
      expect(memory.importance_score).toBe(0.5)
    })
  })
})
