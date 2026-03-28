import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DatabaseService } from '../../src/main/context/database-service'
import {
  extractDecisions,
  isDuplicateDecision,
} from '../../src/main/context/smart-extractors'
import { __initSqlWasm } from '../__mocks__/better-sqlite3'

beforeAll(async () => {
  await __initSqlWasm()
})

describe('CTX-006: expanded decision extraction patterns + deduplication', () => {
  let tempDir: string
  let db: DatabaseService
  let projectId: string
  let sessionId: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clui-decision-patterns-test-'))
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

  describe('new pattern: "we should use X"', () => {
    it('captures "We should use Zustand for state management"', () => {
      db.insertMessage(
        sessionId,
        'assistant',
        'We should use Zustand for state management because it has minimal boilerplate.',
        1,
      )

      extractDecisions(db, projectId, sessionId)

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(decisions.length).toBeGreaterThan(0)
      expect(decisions.some((d: any) => d.body.includes('Zustand for state management'))).toBe(true)
    })
  })

  describe('new pattern: "let\'s go with X"', () => {
    it('captures "Let\'s go with React Query"', () => {
      db.insertMessage(
        sessionId,
        'assistant',
        "Let's go with React Query for data fetching since it handles caching automatically.",
        1,
      )

      extractDecisions(db, projectId, sessionId)

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(decisions.length).toBeGreaterThan(0)
      expect(decisions.some((d: any) => d.body.includes('React Query'))).toBe(true)
    })
  })

  describe('new pattern: "the approach will be X"', () => {
    it('captures "The approach will be TDD"', () => {
      db.insertMessage(
        sessionId,
        'assistant',
        'The approach will be TDD so we catch regressions early and maintain confidence.',
        1,
      )

      extractDecisions(db, projectId, sessionId)

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(decisions.length).toBeGreaterThan(0)
      expect(decisions.some((d: any) => d.body.includes('TDD'))).toBe(true)
    })
  })

  describe('new pattern: "I recommend X"', () => {
    it('captures "I recommend using Vitest"', () => {
      db.insertMessage(
        sessionId,
        'assistant',
        'I recommend using Vitest because it has native TypeScript support and fast execution.',
        1,
      )

      extractDecisions(db, projectId, sessionId)

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(decisions.length).toBeGreaterThan(0)
      expect(decisions.some((d: any) => d.body.includes('using Vitest'))).toBe(true)
    })
  })

  describe('new pattern: "switched from X to Y"', () => {
    it('captures "Switched from Jest to Vitest"', () => {
      db.insertMessage(
        sessionId,
        'assistant',
        'Switched from Jest to Vitest because of better ESM and TypeScript support out of the box.',
        1,
      )

      extractDecisions(db, projectId, sessionId)

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(decisions.length).toBeGreaterThan(0)
      expect(decisions.some((d: any) => d.body.includes('Jest to Vitest'))).toBe(true)
    })
  })

  describe('new pattern: "better to use X"', () => {
    it('captures "better to use PostgreSQL for this workload"', () => {
      db.insertMessage(
        sessionId,
        'assistant',
        "It's better to use PostgreSQL for this workload due to complex query requirements and ACID compliance.",
        1,
      )

      extractDecisions(db, projectId, sessionId)

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(decisions.length).toBeGreaterThan(0)
      expect(decisions.some((d: any) => d.body.includes('PostgreSQL'))).toBe(true)
    })
  })

  describe('deduplication via Jaccard similarity', () => {
    it('deduplicates two similar decisions producing only one memory', () => {
      // Insert two messages with very similar decision text
      db.insertMessage(
        sessionId,
        'assistant',
        'We should use Zustand for state management because it is simple and lightweight.',
        1,
      )
      db.insertMessage(
        sessionId,
        'assistant',
        'We should use Zustand for state management since it has minimal boilerplate overhead.',
        2,
      )

      extractDecisions(db, projectId, sessionId)

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      // Should deduplicate: only one decision about "Zustand for state management"
      expect(decisions.length).toBe(1)
    })
  })

  describe('isDuplicateDecision', () => {
    it('returns true for >0.6 Jaccard similarity', () => {
      expect(
        isDuplicateDecision(
          'use Zustand for state management in React',
          'use Zustand for state management in the app',
        ),
      ).toBe(true)
    })

    it('returns false for low similarity', () => {
      expect(
        isDuplicateDecision(
          'use Zustand for state management',
          'switched from Jest to Vitest for testing',
        ),
      ).toBe(false)
    })
  })

  describe('false positive mitigation', () => {
    it('does NOT capture "let\'s go" alone without a concrete noun', () => {
      db.insertMessage(
        sessionId,
        'assistant',
        "Alright, let's go!",
        1,
      )

      extractDecisions(db, projectId, sessionId)

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(decisions.length).toBe(0)
    })

    it('does NOT capture very short matches under 20 chars', () => {
      db.insertMessage(
        sessionId,
        'assistant',
        'The approach will be X.',
        1,
      )

      extractDecisions(db, projectId, sessionId)

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(decisions.length).toBe(0)
    })
  })

  describe('max 8 decisions per session', () => {
    it('limits to 8 decisions even with many matches', () => {
      // Insert many messages that each match decision patterns
      const topics = [
        'Zustand for state management because of simplicity',
        'React Query for data fetching because of caching',
        'Tailwind CSS for styling because of utility classes',
        'Vitest for testing because of speed and TypeScript',
        'PostgreSQL for the database because of reliability',
        'Redis for caching because of performance benchmarks',
        'Docker for containerization because of portability',
        'Kubernetes for orchestration because of scalability',
        'GraphQL for the API layer because of flexibility',
        'Prisma for the ORM layer because of type safety',
        'Nginx for reverse proxy because of efficiency',
        'Terraform for infrastructure because of reproducibility',
      ]

      topics.forEach((topic, i) => {
        db.insertMessage(
          sessionId,
          'assistant',
          `We should use ${topic}.`,
          i + 1,
        )
      })

      extractDecisions(db, projectId, sessionId)

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND session_id = ? AND deleted_at IS NULL')
        .all(projectId, sessionId) as any[]

      expect(decisions.length).toBeLessThanOrEqual(8)
    })
  })

  describe('existing patterns still work', () => {
    it('still extracts "chose X over Y"', () => {
      db.insertMessage(
        sessionId,
        'assistant',
        'I chose JWT tokens over session cookies because of stateless scaling requirements.',
        1,
      )

      extractDecisions(db, projectId, sessionId)

      const decisions = db.db
        .prepare('SELECT * FROM decisions WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId) as any[]

      expect(decisions.length).toBeGreaterThan(0)
      expect(decisions[0].body).toContain('JWT')
    })

    it('still extracts "decided on"', () => {
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
  })
})
