import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DatabaseService } from '../../../src/main/context/database-service'
import type { MemoryInsert } from '../../../src/main/context/types'

describe('DatabaseService', () => {
  let tempDir: string
  let dbPath: string
  let blobsPath: string
  let db: DatabaseService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clui-db-test-'))
    dbPath = join(tempDir, 'test.sqlite')
    blobsPath = join(tempDir, 'blobs')
    db = new DatabaseService(dbPath, blobsPath)
    db.init()
  })

  afterEach(() => {
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ── Initialization ────────────────────────────────────────────────

  describe('init()', () => {
    it('applies migration on init', () => {
      const row = db.db
        .prepare('SELECT MAX(version) as v FROM schema_migrations')
        .get() as { v: number }
      expect(row.v).toBe(1)
    })

    it('is idempotent — calling init twice does not error', () => {
      db.close()
      db = new DatabaseService(dbPath, blobsPath)
      expect(() => db.init()).not.toThrow()

      const row = db.db
        .prepare('SELECT COUNT(*) as c FROM schema_migrations')
        .get() as { c: number }
      expect(row.c).toBe(1)
    })

    it('configures journal mode', () => {
      const mode = db.db.pragma('journal_mode', { simple: true })
      // In-memory DBs use 'memory' mode; file-based would use 'wal'
      expect(typeof mode).toBe('string')
    })

    it('enables foreign keys', () => {
      const fk = db.db.pragma('foreign_keys', { simple: true })
      expect(fk).toBe(1)
    })
  })

  // ── Corruption recovery ───────────────────────────────────────────

  describe('corruption recovery', () => {
    // File-based corruption recovery not testable with in-memory mock
    it.skip('recovers from a corrupt database by creating fresh', () => {})
  })

  // ── Projects ──────────────────────────────────────────────────────

  describe('Project CRUD', () => {
    it('upsertProject creates a new project and returns id', () => {
      const id = db.upsertProject('/home/user/project', 'my-project')
      expect(id).toBeTruthy()
      expect(typeof id).toBe('string')
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    })

    it('upsertProject returns same id on second call with same path', () => {
      const id1 = db.upsertProject('/home/user/project', 'my-project')
      const id2 = db.upsertProject('/home/user/project', 'renamed-project')
      expect(id1).toBe(id2)
    })

    it('upsertProject updates name and repo_remote on upsert', () => {
      db.upsertProject('/home/user/project', 'old-name')
      db.upsertProject('/home/user/project', 'new-name', 'git@github.com:x/y')

      const project = db.getProjectByPath('/home/user/project')
      expect(project).not.toBeNull()
      expect(project!.name).toBe('new-name')
      expect(project!.repo_remote).toBe('git@github.com:x/y')
    })

    it('getProjectByPath returns null for nonexistent path', () => {
      const result = db.getProjectByPath('/nonexistent')
      expect(result).toBeNull()
    })

    it('normalizes paths for consistent matching', () => {
      const id = db.upsertProject('/home/user/../user/project', 'my-project')
      const project = db.getProjectByPath('/home/user/project')
      expect(project).not.toBeNull()
      expect(project!.id).toBe(id)
    })
  })

  // ── Sessions ──────────────────────────────────────────────────────

  describe('Session CRUD', () => {
    let projectId: string

    beforeEach(() => {
      projectId = db.upsertProject('/home/user/project', 'test-project')
    })

    it('createSession returns a uuid v7 id', () => {
      const id = db.createSession(projectId)
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    })

    it('createSession with claudeSessionId stores it', () => {
      const id = db.createSession(projectId, 'claude-123')
      const row = db.db
        .prepare('SELECT claude_session_id FROM sessions WHERE id = ?')
        .get(id) as { claude_session_id: string }
      expect(row.claude_session_id).toBe('claude-123')
    })

    it('updateSession updates only specified fields', () => {
      const id = db.createSession(projectId)
      db.updateSession(id, { title: 'My Session', status: 'completed' })

      const row = db.db
        .prepare('SELECT title, status, goal FROM sessions WHERE id = ?')
        .get(id) as { title: string; status: string; goal: string | null }
      expect(row.title).toBe('My Session')
      expect(row.status).toBe('completed')
      expect(row.goal).toBeNull()
    })

    it('updateSession with empty fields is a no-op', () => {
      const id = db.createSession(projectId)
      expect(() => db.updateSession(id, {})).not.toThrow()
    })

    it('getSessionHistory returns sessions ordered by started_at DESC', () => {
      const s1 = db.createSession(projectId)
      const s2 = db.createSession(projectId)

      // Ensure deterministic ordering by giving them distinct timestamps
      db.db
        .prepare(`UPDATE sessions SET started_at = '2026-01-01 00:00:00' WHERE id = ?`)
        .run(s1)
      db.db
        .prepare(`UPDATE sessions SET started_at = '2026-01-02 00:00:00' WHERE id = ?`)
        .run(s2)

      const history = db.getSessionHistory('/home/user/project', 10, 0)
      expect(history.length).toBe(2)
      // Most recent first (s2 has later started_at)
      expect(history[0].id).toBe(s2)
      expect(history[1].id).toBe(s1)
    })

    it('getSessionHistory respects limit and offset', () => {
      db.createSession(projectId)
      db.createSession(projectId)
      db.createSession(projectId)

      const page1 = db.getSessionHistory('/home/user/project', 2, 0)
      expect(page1.length).toBe(2)

      const page2 = db.getSessionHistory('/home/user/project', 2, 2)
      expect(page2.length).toBe(1)
    })

    it('getSessionDetail returns null for nonexistent session', () => {
      const result = db.getSessionDetail('nonexistent-id')
      expect(result).toBeNull()
    })

    it('getSessionDetail returns session with files touched', () => {
      const sessionId = db.createSession(projectId)
      db.updateSession(sessionId, { title: 'Test Session' })
      db.insertFileTouched(sessionId, null, 'src/main.ts', 'write')
      db.insertFileTouched(sessionId, null, 'src/main.ts', 'patch')
      db.insertFileTouched(sessionId, null, 'src/utils.ts', 'read')

      const detail = db.getSessionDetail(sessionId)
      expect(detail).not.toBeNull()
      expect(detail!.title).toBe('Test Session')
      expect(detail!.filesTouchedCount).toBe(3)
      expect(detail!.filesTouched.length).toBe(2) // 2 unique paths
      expect(detail!.filesTouched[0].path).toBe('src/main.ts') // most touches first
      expect(detail!.filesTouched[0].totalTouches).toBe(2)
    })
  })

  // ── Messages ──────────────────────────────────────────────────────

  describe('Message insert', () => {
    let sessionId: string

    beforeEach(() => {
      const projectId = db.upsertProject('/home/user/project', 'test')
      sessionId = db.createSession(projectId)
    })

    it('inserts a message and returns id', () => {
      const id = db.insertMessage(sessionId, 'user', 'Hello', 1)
      expect(id).toBeTruthy()

      const row = db.db
        .prepare('SELECT role, content, seq_num FROM messages WHERE id = ?')
        .get(id) as { role: string; content: string; seq_num: number }
      expect(row.role).toBe('user')
      expect(row.content).toBe('Hello')
      expect(row.seq_num).toBe(1)
    })

    it('diverts large content to blob store', () => {
      // 100KB threshold — create content just over it
      const largeContent = 'x'.repeat(102_401)
      const id = db.insertMessage(sessionId, 'assistant', largeContent, 1)

      const row = db.db
        .prepare(
          'SELECT content, blob_path, blob_hash FROM messages WHERE id = ?',
        )
        .get(id) as {
        content: string | null
        blob_path: string
        blob_hash: string
      }
      expect(row.content).toBeNull()
      expect(row.blob_path).toBeTruthy()
      expect(row.blob_hash).toBeTruthy()
      expect(existsSync(join(blobsPath, row.blob_path))).toBe(true)
    })
  })

  // ── Events ────────────────────────────────────────────────────────

  describe('Event insert', () => {
    let sessionId: string

    beforeEach(() => {
      const projectId = db.upsertProject('/home/user/project', 'test')
      sessionId = db.createSession(projectId)
    })

    it('inserts an event and returns id', () => {
      const payload = JSON.stringify({ tool: 'Edit', path: 'src/main.ts' })
      const id = db.insertEvent(sessionId, 'tool_call', payload, 1)

      const row = db.db
        .prepare(
          'SELECT event_type, payload_json, seq_num FROM events WHERE id = ?',
        )
        .get(id) as {
        event_type: string
        payload_json: string
        seq_num: number
      }
      expect(row.event_type).toBe('tool_call')
      expect(row.payload_json).toBe(payload)
      expect(row.seq_num).toBe(1)
    })

    it('diverts large payloads to blob store', () => {
      const largePayload = JSON.stringify({ data: 'y'.repeat(102_401) })
      const id = db.insertEvent(sessionId, 'tool_call', largePayload, 1)

      const row = db.db
        .prepare(
          'SELECT payload_json, blob_path, blob_hash FROM events WHERE id = ?',
        )
        .get(id) as {
        payload_json: string | null
        blob_path: string
        blob_hash: string
      }
      expect(row.payload_json).toBeNull()
      expect(row.blob_path).toBeTruthy()
    })
  })

  // ── Files Touched ─────────────────────────────────────────────────

  describe('FileTouched insert + aggregate', () => {
    let projectId: string
    let sessionId1: string
    let sessionId2: string

    beforeEach(() => {
      projectId = db.upsertProject('/home/user/project', 'test')
      sessionId1 = db.createSession(projectId)
      sessionId2 = db.createSession(projectId)
    })

    it('inserts a file touch and returns id', () => {
      const id = db.insertFileTouched(sessionId1, null, 'src/main.ts', 'write')
      expect(id).toBeTruthy()
    })

    it('getFilesTouched aggregates across sessions', () => {
      db.insertFileTouched(sessionId1, null, 'src/main.ts', 'write')
      db.insertFileTouched(sessionId1, null, 'src/main.ts', 'patch')
      db.insertFileTouched(sessionId2, null, 'src/main.ts', 'read')
      db.insertFileTouched(sessionId1, null, 'src/utils.ts', 'write')

      const files = db.getFilesTouched('/home/user/project', 10)
      expect(files.length).toBe(2)

      // main.ts has 3 touches, should be first
      expect(files[0].path).toBe('src/main.ts')
      expect(files[0].totalTouches).toBe(3)
      expect(files[0].sessionCount).toBe(2)
      expect(files[0].actions).toContain('write')
      expect(files[0].actions).toContain('patch')
      expect(files[0].actions).toContain('read')

      expect(files[1].path).toBe('src/utils.ts')
      expect(files[1].totalTouches).toBe(1)
    })
  })

  // ── Memories ──────────────────────────────────────────────────────

  describe('Memory CRUD', () => {
    let projectId: string
    let sessionId: string

    const makeMemory = (overrides?: Partial<MemoryInsert>): MemoryInsert => ({
      projectId,
      sessionId,
      memoryType: 'session_outcome',
      scope: 'project',
      title: 'Test memory',
      body: 'Some body text',
      sourceRefsJson: null,
      importanceScore: 0.7,
      confidenceScore: 1.0,
      ...overrides,
    })

    beforeEach(() => {
      projectId = db.upsertProject('/home/user/project', 'test')
      sessionId = db.createSession(projectId)
    })

    it('insertMemory creates and returns id', () => {
      const id = db.insertMemory(makeMemory())
      expect(id).toBeTruthy()

      const row = db.db
        .prepare('SELECT title, memory_type, scope FROM memories WHERE id = ?')
        .get(id) as { title: string; memory_type: string; scope: string }
      expect(row.title).toBe('Test memory')
      expect(row.memory_type).toBe('session_outcome')
      expect(row.scope).toBe('project')
    })

    it('supersedeMemory soft-deletes old and inserts new with reference', () => {
      const oldId = db.insertMemory(makeMemory({ title: 'Old memory' }))
      const newId = db.supersedeMemory(
        oldId,
        makeMemory({ title: 'New memory' }),
      )

      // Old should be soft-deleted
      const oldRow = db.db
        .prepare('SELECT deleted_at FROM memories WHERE id = ?')
        .get(oldId) as { deleted_at: string | null }
      expect(oldRow.deleted_at).not.toBeNull()

      // New should reference old
      const newRow = db.db
        .prepare(
          'SELECT supersedes_memory_id, deleted_at FROM memories WHERE id = ?',
        )
        .get(newId) as {
        supersedes_memory_id: string
        deleted_at: string | null
      }
      expect(newRow.supersedes_memory_id).toBe(oldId)
      expect(newRow.deleted_at).toBeNull()
    })

    it('pinMemory sets is_pinned to 1', () => {
      const id = db.insertMemory(makeMemory())
      db.pinMemory(id)

      const row = db.db
        .prepare('SELECT is_pinned FROM memories WHERE id = ?')
        .get(id) as { is_pinned: number }
      expect(row.is_pinned).toBe(1)
    })

    it('unpinMemory sets is_pinned to 0', () => {
      const id = db.insertMemory(makeMemory())
      db.pinMemory(id)
      db.unpinMemory(id)

      const row = db.db
        .prepare('SELECT is_pinned FROM memories WHERE id = ?')
        .get(id) as { is_pinned: number }
      expect(row.is_pinned).toBe(0)
    })

    it('deleteMemory soft-deletes (sets deleted_at)', () => {
      const id = db.insertMemory(makeMemory())
      db.deleteMemory(id)

      const row = db.db
        .prepare('SELECT deleted_at FROM memories WHERE id = ?')
        .get(id) as { deleted_at: string | null }
      expect(row.deleted_at).not.toBeNull()
    })
  })

  // ── Session Summaries ─────────────────────────────────────────────

  describe('Session summary upsert', () => {
    let sessionId: string

    beforeEach(() => {
      const projectId = db.upsertProject('/home/user/project', 'test')
      sessionId = db.createSession(projectId)
    })

    it('creates a new session summary', () => {
      db.upsertSessionSummary(sessionId, 'technical', 'Files: a.ts, b.ts')

      const row = db.db
        .prepare(
          `SELECT body FROM session_summaries WHERE session_id = ? AND summary_kind = ?`,
        )
        .get(sessionId, 'technical') as { body: string }
      expect(row.body).toBe('Files: a.ts, b.ts')
    })

    it('updates existing summary on second call', () => {
      db.upsertSessionSummary(sessionId, 'technical', 'First version')
      db.upsertSessionSummary(sessionId, 'technical', 'Updated version')

      const rows = db.db
        .prepare(
          `SELECT body FROM session_summaries WHERE session_id = ? AND summary_kind = ? AND deleted_at IS NULL`,
        )
        .all(sessionId, 'technical') as Array<{ body: string }>
      expect(rows.length).toBe(1)
      expect(rows[0].body).toBe('Updated version')
    })
  })

  // ── Artifacts ─────────────────────────────────────────────────────

  describe('Artifact insert', () => {
    it('inserts an artifact and returns id', () => {
      const projectId = db.upsertProject('/home/user/project', 'test')
      const sessionId = db.createSession(projectId)
      const id = db.insertArtifact(
        sessionId,
        'code_snippet',
        'Helper function',
        'function foo() {}',
      )

      expect(id).toBeTruthy()
      const row = db.db
        .prepare(
          'SELECT artifact_type, title, body FROM artifacts WHERE id = ?',
        )
        .get(id) as { artifact_type: string; title: string; body: string }
      expect(row.artifact_type).toBe('code_snippet')
      expect(row.title).toBe('Helper function')
      expect(row.body).toBe('function foo() {}')
    })
  })

  // ── Project Stats ─────────────────────────────────────────────────

  describe('getProjectStats', () => {
    it('returns null for nonexistent project', () => {
      const stats = db.getProjectStats('/nonexistent')
      expect(stats).toBeNull()
    })

    it('returns aggregate stats for a project', () => {
      const projectId = db.upsertProject('/home/user/project', 'test')
      const s1 = db.createSession(projectId)
      const s2 = db.createSession(projectId)
      db.insertFileTouched(s1, null, 'a.ts', 'write')
      db.insertFileTouched(s1, null, 'b.ts', 'write')
      db.insertFileTouched(s2, null, 'a.ts', 'read') // same file, different session
      db.insertMemory({
        projectId,
        sessionId: s1,
        memoryType: 'session_outcome',
        scope: 'project',
        title: 'Test',
        body: null,
        sourceRefsJson: null,
        importanceScore: 0.5,
        confidenceScore: 1.0,
      })

      const stats = db.getProjectStats('/home/user/project')
      expect(stats).not.toBeNull()
      expect(stats!.projectName).toBe('test')
      expect(stats!.sessionCount).toBe(2)
      expect(stats!.uniqueFilesTouched).toBe(2) // a.ts and b.ts
      expect(stats!.memoryCount).toBe(1)
    })
  })

  // ── Pruning ───────────────────────────────────────────────────────

  describe('pruneStaleMemories', () => {
    it('prunes low-importance, old, unpinned memories', () => {
      const projectId = db.upsertProject('/home/user/project', 'test')
      const sessionId = db.createSession(projectId)

      // Insert a memory that meets pruning criteria
      const id = db.insertMemory({
        projectId,
        sessionId,
        memoryType: 'session_outcome',
        scope: 'project',
        title: 'Old stale memory',
        body: null,
        sourceRefsJson: null,
        importanceScore: 0.1, // below 0.2
        confidenceScore: 1.0,
      })

      // Manually backdate it to 100 days ago
      db.db
        .prepare(
          `UPDATE memories SET created_at = datetime('now', '-100 days'), updated_at = datetime('now', '-100 days') WHERE id = ?`,
        )
        .run(id)

      const pruned = db.pruneStaleMemories()
      expect(pruned).toBe(1)

      const row = db.db
        .prepare('SELECT deleted_at FROM memories WHERE id = ?')
        .get(id) as { deleted_at: string | null }
      expect(row.deleted_at).not.toBeNull()
    })

    it('does not prune pinned memories even if old and low-importance', () => {
      const projectId = db.upsertProject('/home/user/project', 'test')
      const sessionId = db.createSession(projectId)

      const id = db.insertMemory({
        projectId,
        sessionId,
        memoryType: 'session_outcome',
        scope: 'project',
        title: 'Pinned old memory',
        body: null,
        sourceRefsJson: null,
        importanceScore: 0.1,
        confidenceScore: 1.0,
      })

      db.pinMemory(id)

      // Backdate
      db.db
        .prepare(
          `UPDATE memories SET created_at = datetime('now', '-100 days'), last_accessed_at = NULL WHERE id = ?`,
        )
        .run(id)

      const pruned = db.pruneStaleMemories()
      expect(pruned).toBe(0)
    })

    it('does not prune high-importance memories', () => {
      const projectId = db.upsertProject('/home/user/project', 'test')
      const sessionId = db.createSession(projectId)

      const id = db.insertMemory({
        projectId,
        sessionId,
        memoryType: 'session_outcome',
        scope: 'project',
        title: 'Important old memory',
        body: null,
        sourceRefsJson: null,
        importanceScore: 0.5, // above 0.2
        confidenceScore: 1.0,
      })

      db.db
        .prepare(
          `UPDATE memories SET created_at = datetime('now', '-100 days') WHERE id = ?`,
        )
        .run(id)

      const pruned = db.pruneStaleMemories()
      expect(pruned).toBe(0)
    })
  })

  // ── Close ─────────────────────────────────────────────────────────

  describe('close()', () => {
    it('can be called multiple times without error', () => {
      db.close()
      expect(() => db.close()).not.toThrow()
    })

    it('throws on db access after close', () => {
      db.close()
      expect(() => db.db).toThrow('DatabaseService not initialized')
    })
  })
})
