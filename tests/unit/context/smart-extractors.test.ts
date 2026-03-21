import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DatabaseService } from '../../../src/main/context/database-service'
import {
  extractDecisions,
  extractPitfalls,
  buildCooccurrenceMap,
  pruneCooccurrences,
} from '../../../src/main/context/smart-extractors'
import { __initSqlWasm } from '../../__mocks__/better-sqlite3'

beforeAll(async () => {
  await __initSqlWasm()
})

describe('smart-extractors', () => {
  let tempDir: string
  let db: DatabaseService
  let projectId: string
  let sessionId: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clui-smart-ext-test-'))
    const dbPath = join(tempDir, 'test.sqlite')
    const blobsPath = join(tempDir, 'blobs')
    db = new DatabaseService(dbPath, blobsPath)
    db.init()

    projectId = db.upsertProject('/test/project', 'test-project')
    sessionId = db.createSession(projectId, 'claude-test')
  })

  afterEach(() => {
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('extractDecisions', () => {
    it('extracts decision from "chose X over Y" pattern', () => {
      // Insert assistant message with a decision pattern
      db.insertMessage(
        sessionId,
        'assistant',
        'I chose JWT tokens over session cookies because of stateless scaling requirements.',
        1,
      )
      db.updateSession(sessionId, { status: 'completed' })

      extractDecisions(db, projectId, sessionId)

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(decisions.length).toBeGreaterThan(0)
      expect(decisions[0].body).toContain('JWT')
    })

    it('extracts decision from "decided to" pattern', () => {
      db.insertMessage(
        sessionId,
        'assistant',
        'We decided on using barrel exports for the utils directory to avoid circular dependencies.',
        1,
      )

      extractDecisions(db, projectId, sessionId)

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(decisions.length).toBeGreaterThan(0)
    })

    it('does not create duplicate decisions', () => {
      db.insertMessage(
        sessionId,
        'assistant',
        'I chose JWT tokens over session cookies for authentication.',
        1,
      )

      extractDecisions(db, projectId, sessionId)
      extractDecisions(db, projectId, sessionId) // Run twice

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      // Should not have duplicates with the same title
      const titles = decisions.map((d: any) => d.title)
      const uniqueTitles = [...new Set(titles)]
      expect(titles.length).toBe(uniqueTitles.length)
    })

    it('skips user messages', () => {
      db.insertMessage(
        sessionId,
        'user',
        'I chose JWT tokens over session cookies.',
        1,
      )

      extractDecisions(db, projectId, sessionId)

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(decisions.length).toBe(0)
    })
  })

  describe('extractPitfalls', () => {
    it('creates pitfall from error in completed session', () => {
      // Insert an error event
      db.insertEvent(
        sessionId,
        'error',
        JSON.stringify({ message: 'fs.readFileSync caused 2s latency in hot path' }),
        1,
      )

      // Mark session as completed (errors were resolved)
      db.updateSession(sessionId, { status: 'completed', ended_at: new Date().toISOString() })

      extractPitfalls(db, projectId, sessionId)

      const pitfalls = db.db
        .prepare('SELECT * FROM pitfalls WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(pitfalls.length).toBe(1)
      expect(pitfalls[0].title).toContain('fs.readFileSync')
    })

    it('increments occurrence_count for repeated pitfalls', () => {
      db.insertEvent(
        sessionId,
        'error',
        JSON.stringify({ message: 'Timeout error on database query' }),
        1,
      )
      db.updateSession(sessionId, { status: 'completed', ended_at: new Date().toISOString() })

      extractPitfalls(db, projectId, sessionId)
      extractPitfalls(db, projectId, sessionId) // Run twice

      const pitfalls = db.db
        .prepare('SELECT * FROM pitfalls WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(pitfalls.length).toBe(1)
      expect(pitfalls[0].occurrence_count).toBe(2)
    })

    it('does not create pitfall for non-completed session', () => {
      db.insertEvent(
        sessionId,
        'error',
        JSON.stringify({ message: 'Some error message' }),
        1,
      )
      // Session still active (not completed)

      extractPitfalls(db, projectId, sessionId)

      const pitfalls = db.db
        .prepare('SELECT * FROM pitfalls WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(pitfalls.length).toBe(0)
    })

    it('skips events without error message', () => {
      db.insertEvent(
        sessionId,
        'error',
        JSON.stringify({ code: 'ERR_TIMEOUT' }),
        1,
      )
      db.updateSession(sessionId, { status: 'completed', ended_at: new Date().toISOString() })

      extractPitfalls(db, projectId, sessionId)

      const pitfalls = db.db
        .prepare('SELECT * FROM pitfalls WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(pitfalls.length).toBe(0)
    })
  })

  describe('buildCooccurrenceMap', () => {
    it('builds co-occurrence entries from session messages', () => {
      db.insertMessage(
        sessionId,
        'user',
        'Fix the authentication JWT token refresh flow',
        1,
      )
      db.insertMessage(
        sessionId,
        'assistant',
        'I will fix the authentication token refresh logic in the JWT module',
        2,
      )

      buildCooccurrenceMap(db, projectId, sessionId)

      const cooccurrences = db.db
        .prepare('SELECT * FROM term_cooccurrences WHERE project_id = ?')
        .all(projectId) as any[]

      expect(cooccurrences.length).toBeGreaterThan(0)

      // Check that "authentication" and "jwt" co-occur
      const authJwt = cooccurrences.find(
        (c: any) =>
          (c.term_a === 'authentication' && c.term_b === 'jwt') ||
          (c.term_a === 'jwt' && c.term_b === 'authentication'),
      )
      expect(authJwt).toBeDefined()
    })

    it('increments weight on repeated co-occurrences', () => {
      db.insertMessage(sessionId, 'user', 'authentication jwt token', 1)

      buildCooccurrenceMap(db, projectId, sessionId)
      buildCooccurrenceMap(db, projectId, sessionId) // Run twice

      const entry = db.db
        .prepare(
          `SELECT weight FROM term_cooccurrences
           WHERE project_id = ? AND term_a = 'authentication' AND term_b = 'jwt'`,
        )
        .get(projectId) as any

      expect(entry).toBeDefined()
      expect(entry.weight).toBe(2.0)
    })

    it('handles empty messages gracefully', () => {
      // No messages in session
      buildCooccurrenceMap(db, projectId, sessionId)

      const cooccurrences = db.db
        .prepare('SELECT * FROM term_cooccurrences WHERE project_id = ?')
        .all(projectId) as any[]

      expect(cooccurrences.length).toBe(0)
    })
  })

  describe('pruneCooccurrences', () => {
    it('removes low-weight terms when exceeding cap', () => {
      // Insert many unique terms to exceed the 500 cap
      const insert = db.db.prepare(
        `INSERT INTO term_cooccurrences (project_id, term_a, term_b, weight)
         VALUES (?, ?, ?, ?)`,
      )

      const batch = db.db.transaction(() => {
        // Create 520 unique term_a values, each with one pair
        for (let i = 0; i < 520; i++) {
          const termA = `term_${String(i).padStart(4, '0')}`
          const termB = `pair_${String(i).padStart(4, '0')}`
          // Higher-numbered terms get higher weight so we know which survive
          insert.run(projectId, termA, termB, i + 1)
          insert.run(projectId, termB, termA, i + 1)
        }
      })
      batch()

      const beforeCount = db.db
        .prepare(
          'SELECT COUNT(DISTINCT term_a) as cnt FROM term_cooccurrences WHERE project_id = ?',
        )
        .get(projectId) as any

      expect(beforeCount.cnt).toBeGreaterThan(500)

      pruneCooccurrences(db, projectId)

      const afterCount = db.db
        .prepare(
          'SELECT COUNT(DISTINCT term_a) as cnt FROM term_cooccurrences WHERE project_id = ?',
        )
        .get(projectId) as any

      expect(afterCount.cnt).toBeLessThanOrEqual(500)
    })

    it('does not prune when under cap', () => {
      const insert = db.db.prepare(
        `INSERT INTO term_cooccurrences (project_id, term_a, term_b, weight)
         VALUES (?, ?, ?, 1.0)`,
      )

      // Insert just 10 terms — well under cap
      for (let i = 0; i < 10; i++) {
        insert.run(projectId, `term_${i}`, `pair_${i}`)
      }

      pruneCooccurrences(db, projectId)

      const count = db.db
        .prepare(
          'SELECT COUNT(*) as cnt FROM term_cooccurrences WHERE project_id = ?',
        )
        .get(projectId) as any

      expect(count.cnt).toBe(10)
    })
  })
})
