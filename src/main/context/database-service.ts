import type Database from 'better-sqlite3'
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'fs'

// Lazy-load better-sqlite3 to avoid crashing the app if the native module is missing
// (e.g., Linux without build-essential). The app degrades gracefully without context DB.
let BetterSqlite3: typeof import('better-sqlite3').default | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BetterSqlite3 = require('better-sqlite3')
} catch (err) {
  console.warn('[DatabaseService] better-sqlite3 native module not available:', err)
}
import { dirname, resolve, normalize } from 'path'
import { generateId } from './id'
import { shouldUseBlob, writeBlob } from './blob-store'
import { migration as migration001 } from './migrations/001-initial-schema'
import { migration as migration002 } from './migrations/002-smart-context'
import { migration as migration003 } from './migrations/003-memory-decay'
import type {
  Migration,
  ProjectRow,
  SessionUpdate,
  MemoryInsert,
  ContextSessionSummary,
  ContextProjectStats,
  ContextFileTouched,
} from './types'

const MIGRATIONS: Migration[] = [migration001, migration002, migration003]

export class DatabaseService {
  private _db: Database.Database | null = null
  private readonly dbPath: string
  private readonly blobsPath: string

  constructor(dbPath: string, blobsPath: string) {
    this.dbPath = dbPath
    this.blobsPath = blobsPath
  }

  get db(): Database.Database {
    if (!this._db) {
      throw new Error('DatabaseService not initialized. Call init() first.')
    }
    return this._db
  }

  // ── Initialization ──────────────────────────────────────────────────

  init(): void {
    if (!BetterSqlite3) {
      console.warn('[DatabaseService] Skipping init — better-sqlite3 not available')
      return
    }

    const dir = dirname(this.dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    try {
      this._db = new BetterSqlite3(this.dbPath)
      this._db.pragma('journal_mode = WAL')
      this._db.pragma('foreign_keys = ON')
      this._db.pragma('busy_timeout = 5000')
    } catch (err) {
      this.handleCorruption(err)
      return
    }

    // Verify PRAGMAs actually applied — catches corruption
    try {
      const fk = this._db.pragma('foreign_keys', { simple: true })
      if (fk !== 1) {
        throw new Error(`foreign_keys PRAGMA returned ${fk}, expected 1`)
      }
    } catch (err) {
      this.handleCorruption(err)
      return
    }

    this.runMigrations()
  }

  private handleCorruption(err: unknown): void {
    console.warn(
      '[DatabaseService] Database error, creating fresh database:',
      err,
    )

    // Close if open
    if (this._db) {
      try {
        this._db.close()
      } catch {
        // ignore close errors on corrupt db
      }
      this._db = null
    }

    // Rename corrupt file + clean up WAL/SHM (they're tied to the base file)
    if (existsSync(this.dbPath)) {
      const timestamp = Date.now()
      const corruptPath = `${this.dbPath}.corrupt.${timestamp}`
      renameSync(this.dbPath, corruptPath)
      console.warn(`[DatabaseService] Corrupt database moved to: ${corruptPath}`)
    }
    for (const suffix of ['-wal', '-shm']) {
      const walPath = `${this.dbPath}${suffix}`
      if (existsSync(walPath)) {
        try { unlinkSync(walPath) } catch { /* ignore */ }
      }
    }

    // Create fresh — if this also fails, let it propagate (caller catches)
    try {
      this._db = new BetterSqlite3!(this.dbPath)
      this._db.pragma('journal_mode = WAL')
      this._db.pragma('foreign_keys = ON')
      this._db.pragma('busy_timeout = 5000')
      this.runMigrations()
    } catch (freshErr) {
      console.error('[DatabaseService] Failed to create fresh database:', freshErr)
      this._db = null
    }
  }

  private runMigrations(): void {
    const db = this.db

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)

    const currentVersion =
      (
        db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as {
          v: number | null
        }
      )?.v ?? 0

    for (const migration of MIGRATIONS) {
      if (migration.version <= currentVersion) continue

      const runMigration = db.transaction(() => {
        migration.up(db)
        db.prepare(
          'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
        ).run(migration.version, migration.name)
      })

      runMigration()
    }
  }

  // ── Path normalization ──────────────────────────────────────────────

  private normalizePath(rootPath: string): string {
    let p = normalize(resolve(rootPath))
    // Normalize Windows drive letter to uppercase for consistent matching
    if (/^[a-z]:/.test(p)) {
      p = p[0].toUpperCase() + p.slice(1)
    }
    // Normalize separators to forward slashes for cross-platform consistency
    p = p.replace(/\\/g, '/')
    return p
  }

  // ── Projects ────────────────────────────────────────────────────────

  upsertProject(rootPath: string, name: string, repoRemote?: string): string {
    const normalizedPath = this.normalizePath(rootPath)
    const existing = this.db
      .prepare('SELECT id FROM projects WHERE root_path = ?')
      .get(normalizedPath) as { id: string } | undefined

    if (existing) {
      this.db
        .prepare(
          `UPDATE projects SET name = ?, repo_remote = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(name, repoRemote ?? null, existing.id)
      return existing.id
    }

    const id = generateId()
    this.db
      .prepare(
        `INSERT INTO projects (id, name, root_path, repo_remote) VALUES (?, ?, ?, ?)`,
      )
      .run(id, name, normalizedPath, repoRemote ?? null)
    return id
  }

  getProjectByPath(rootPath: string): ProjectRow | null {
    const normalizedPath = this.normalizePath(rootPath)
    return (
      (this.db
        .prepare('SELECT * FROM projects WHERE root_path = ?')
        .get(normalizedPath) as ProjectRow | undefined) ?? null
    )
  }

  // ── Sessions ────────────────────────────────────────────────────────

  createSession(projectId: string, claudeSessionId?: string): string {
    const id = generateId()
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, claude_session_id) VALUES (?, ?, ?)`,
      )
      .run(id, projectId, claudeSessionId ?? null)
    return id
  }

  updateSession(id: string, fields: Partial<SessionUpdate>): void {
    const setClauses: string[] = []
    const values: unknown[] = []

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue
      setClauses.push(`${key} = ?`)
      values.push(value)
    }

    if (setClauses.length === 0) return

    setClauses.push(`updated_at = datetime('now')`)
    values.push(id)

    this.db
      .prepare(`UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`)
      .run(...values)
  }

  getSessionHistory(
    projectPath: string,
    limit: number,
    offset: number,
  ): ContextSessionSummary[] {
    const normalizedPath = this.normalizePath(projectPath)

    const rows = this.db
      .prepare(
        `
        SELECT
          s.id,
          s.title,
          s.goal,
          s.status,
          s.started_at,
          s.ended_at,
          ss.body as summary,
          (SELECT COUNT(*) FROM files_touched ft WHERE ft.session_id = s.id AND ft.deleted_at IS NULL) as files_touched_count
        FROM sessions s
        JOIN projects p ON p.id = s.project_id
        LEFT JOIN session_summaries ss ON ss.session_id = s.id AND ss.summary_kind = 'technical' AND ss.deleted_at IS NULL
        WHERE p.root_path = ? AND s.deleted_at IS NULL
        ORDER BY s.started_at DESC
        LIMIT ? OFFSET ?
      `,
      )
      .all(normalizedPath, limit, offset) as Array<{
      id: string
      title: string | null
      goal: string | null
      status: string
      started_at: string
      ended_at: string | null
      summary: string | null
      files_touched_count: number
    }>

    return rows.map((row) => {
      // Extract tools used from events for this session
      const toolEvents = this.db
        .prepare(
          `
          SELECT DISTINCT event_type FROM events
          WHERE session_id = ? AND event_type LIKE 'tool_%' AND deleted_at IS NULL
        `,
        )
        .all(row.id) as Array<{ event_type: string }>

      const toolsUsed = toolEvents.map((e) => e.event_type)

      let durationMs: number | null = null
      if (row.started_at && row.ended_at) {
        durationMs =
          new Date(row.ended_at).getTime() -
          new Date(row.started_at).getTime()
      }

      return {
        id: row.id,
        title: row.title,
        goal: row.goal,
        status: row.status,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        filesTouchedCount: row.files_touched_count,
        toolsUsed,
        costUsd: null, // V1: cost tracking not yet integrated into context DB
        durationMs,
        summary: row.summary,
      }
    })
  }

  getSessionDetail(
    sessionId: string,
  ): (ContextSessionSummary & { filesTouched: ContextFileTouched[] }) | null {
    const row = this.db
      .prepare(
        `
        SELECT
          s.id,
          s.title,
          s.goal,
          s.status,
          s.started_at,
          s.ended_at,
          ss.body as summary,
          (SELECT COUNT(*) FROM files_touched ft WHERE ft.session_id = s.id AND ft.deleted_at IS NULL) as files_touched_count
        FROM sessions s
        LEFT JOIN session_summaries ss ON ss.session_id = s.id AND ss.summary_kind = 'technical' AND ss.deleted_at IS NULL
        WHERE s.id = ? AND s.deleted_at IS NULL
      `,
      )
      .get(sessionId) as
      | {
          id: string
          title: string | null
          goal: string | null
          status: string
          started_at: string
          ended_at: string | null
          summary: string | null
          files_touched_count: number
        }
      | undefined

    if (!row) return null

    const toolEvents = this.db
      .prepare(
        `
        SELECT DISTINCT event_type FROM events
        WHERE session_id = ? AND event_type LIKE 'tool_%' AND deleted_at IS NULL
      `,
      )
      .all(sessionId) as Array<{ event_type: string }>

    const filesTouchedRows = this.db
      .prepare(
        `
        SELECT
          ft.path,
          COUNT(*) as total_touches,
          GROUP_CONCAT(DISTINCT ft.action) as actions,
          MAX(ft.created_at) as last_touched,
          COUNT(DISTINCT ft.session_id) as session_count
        FROM files_touched ft
        WHERE ft.session_id = ? AND ft.deleted_at IS NULL
        GROUP BY ft.path
        ORDER BY total_touches DESC
      `,
      )
      .all(sessionId) as Array<{
      path: string
      total_touches: number
      actions: string
      last_touched: string
      session_count: number
    }>

    let durationMs: number | null = null
    if (row.started_at && row.ended_at) {
      durationMs =
        new Date(row.ended_at).getTime() - new Date(row.started_at).getTime()
    }

    return {
      id: row.id,
      title: row.title,
      goal: row.goal,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      filesTouchedCount: row.files_touched_count,
      toolsUsed: toolEvents.map((e) => e.event_type),
      costUsd: null,
      durationMs,
      summary: row.summary,
      filesTouched: filesTouchedRows.map((f) => ({
        path: f.path,
        totalTouches: f.total_touches,
        actions: f.actions ? f.actions.split(',') : [],
        lastTouched: f.last_touched,
        sessionCount: f.session_count,
      })),
    }
  }

  // ── Messages ────────────────────────────────────────────────────────

  insertMessage(
    sessionId: string,
    role: string,
    content: string,
    seqNum: number,
  ): string {
    const id = generateId()

    if (shouldUseBlob(content)) {
      const { blobPath, blobHash } = writeBlob(this.blobsPath, content)
      this.db
        .prepare(
          `INSERT INTO messages (id, session_id, role, blob_path, blob_hash, seq_num) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, sessionId, role, blobPath, blobHash, seqNum)
    } else {
      this.db
        .prepare(
          `INSERT INTO messages (id, session_id, role, content, seq_num) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, sessionId, role, content, seqNum)
    }

    return id
  }

  // ── Events ──────────────────────────────────────────────────────────

  insertEvent(
    sessionId: string,
    eventType: string,
    payloadJson: string,
    seqNum: number,
  ): string {
    const id = generateId()

    if (shouldUseBlob(payloadJson)) {
      const { blobPath, blobHash } = writeBlob(this.blobsPath, payloadJson)
      this.db
        .prepare(
          `INSERT INTO events (id, session_id, event_type, blob_path, blob_hash, seq_num) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, sessionId, eventType, blobPath, blobHash, seqNum)
    } else {
      this.db
        .prepare(
          `INSERT INTO events (id, session_id, event_type, payload_json, seq_num) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, sessionId, eventType, payloadJson, seqNum)
    }

    return id
  }

  // ── Files Touched ───────────────────────────────────────────────────

  insertFileTouched(
    sessionId: string,
    eventId: string | null,
    path: string,
    action: string,
  ): string {
    const id = generateId()
    this.db
      .prepare(
        `INSERT INTO files_touched (id, session_id, event_id, path, action) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, sessionId, eventId, path, action)
    return id
  }

  getFilesTouched(projectPath: string, limit: number): ContextFileTouched[] {
    const normalizedPath = this.normalizePath(projectPath)

    const rows = this.db
      .prepare(
        `
        SELECT
          ft.path,
          COUNT(*) as total_touches,
          GROUP_CONCAT(DISTINCT ft.action) as actions,
          MAX(ft.created_at) as last_touched,
          COUNT(DISTINCT ft.session_id) as session_count
        FROM files_touched ft
        JOIN sessions s ON s.id = ft.session_id
        JOIN projects p ON p.id = s.project_id
        WHERE p.root_path = ? AND ft.deleted_at IS NULL AND s.deleted_at IS NULL
        GROUP BY ft.path
        ORDER BY total_touches DESC, last_touched DESC
        LIMIT ?
      `,
      )
      .all(normalizedPath, limit) as Array<{
      path: string
      total_touches: number
      actions: string
      last_touched: string
      session_count: number
    }>

    return rows.map((r) => ({
      path: r.path,
      totalTouches: r.total_touches,
      actions: r.actions ? r.actions.split(',') : [],
      lastTouched: r.last_touched,
      sessionCount: r.session_count,
    }))
  }

  // ── Memories ────────────────────────────────────────────────────────

  insertMemory(memory: MemoryInsert): string {
    const id = generateId()
    this.db
      .prepare(
        `INSERT INTO memories (id, project_id, session_id, memory_type, scope, title, body, source_refs_json, importance_score, confidence_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        memory.projectId,
        memory.sessionId,
        memory.memoryType,
        memory.scope,
        memory.title,
        memory.body,
        memory.sourceRefsJson,
        memory.importanceScore,
        memory.confidenceScore,
      )
    return id
  }

  supersedeMemory(oldId: string, newMemory: MemoryInsert): string {
    const newId = generateId()

    const run = this.db.transaction(() => {
      // Soft-delete old memory
      this.db
        .prepare(
          `UPDATE memories SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        )
        .run(oldId)

      // Insert new memory with supersedes reference
      this.db
        .prepare(
          `INSERT INTO memories (id, project_id, session_id, memory_type, scope, title, body, source_refs_json, importance_score, confidence_score, supersedes_memory_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          newId,
          newMemory.projectId,
          newMemory.sessionId,
          newMemory.memoryType,
          newMemory.scope,
          newMemory.title,
          newMemory.body,
          newMemory.sourceRefsJson,
          newMemory.importanceScore,
          newMemory.confidenceScore,
          oldId,
        )
    })

    run()
    return newId
  }

  pinMemory(id: string): void {
    this.db
      .prepare(
        `UPDATE memories SET is_pinned = 1, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(id)
  }

  unpinMemory(id: string): void {
    this.db
      .prepare(
        `UPDATE memories SET is_pinned = 0, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(id)
  }

  deleteMemory(id: string): void {
    this.db
      .prepare(
        `UPDATE memories SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      )
      .run(id)
  }

  // ── Session Summaries ───────────────────────────────────────────────

  upsertSessionSummary(sessionId: string, kind: string, body: string): void {
    const existing = this.db
      .prepare(
        `SELECT id FROM session_summaries WHERE session_id = ? AND summary_kind = ? AND deleted_at IS NULL`,
      )
      .get(sessionId, kind) as { id: string } | undefined

    if (existing) {
      this.db
        .prepare(`UPDATE session_summaries SET body = ? WHERE id = ?`)
        .run(body, existing.id)
    } else {
      const id = generateId()
      this.db
        .prepare(
          `INSERT INTO session_summaries (id, session_id, summary_kind, body) VALUES (?, ?, ?, ?)`,
        )
        .run(id, sessionId, kind, body)
    }
  }

  // ── Artifacts ───────────────────────────────────────────────────────

  insertArtifact(
    sessionId: string,
    type: string,
    title: string,
    body: string,
  ): string {
    const id = generateId()
    this.db
      .prepare(
        `INSERT INTO artifacts (id, session_id, artifact_type, title, body) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, sessionId, type, title, body)
    return id
  }

  // ── Stats ───────────────────────────────────────────────────────────

  getProjectStats(projectPath: string): ContextProjectStats | null {
    const normalizedPath = this.normalizePath(projectPath)

    const project = this.db
      .prepare('SELECT id, name FROM projects WHERE root_path = ?')
      .get(normalizedPath) as { id: string; name: string } | undefined

    if (!project) return null

    const stats = this.db
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM sessions WHERE project_id = ? AND deleted_at IS NULL) as session_count,
          (SELECT COUNT(DISTINCT ft.path) FROM files_touched ft
           JOIN sessions s ON s.id = ft.session_id
           WHERE s.project_id = ? AND ft.deleted_at IS NULL AND s.deleted_at IS NULL) as unique_files_touched,
          (SELECT COUNT(*) FROM memories WHERE project_id = ? AND deleted_at IS NULL) as memory_count,
          (SELECT MAX(s.started_at) FROM sessions s WHERE s.project_id = ? AND s.deleted_at IS NULL) as last_active_at
      `,
      )
      .get(project.id, project.id, project.id, project.id) as {
      session_count: number
      unique_files_touched: number
      memory_count: number
      last_active_at: string | null
    }

    return {
      projectId: project.id,
      projectName: project.name,
      sessionCount: stats.session_count,
      totalCostUsd: 0, // V1: cost tracking not yet integrated
      uniqueFilesTouched: stats.unique_files_touched,
      memoryCount: stats.memory_count,
      lastActiveAt: stats.last_active_at,
    }
  }

  // ── Maintenance ─────────────────────────────────────────────────────

  pruneStaleMemories(maxAgeDays: number = 60, maxImportance: number = 0.3): number {
    const result = this.db
      .prepare(
        `
        UPDATE memories SET deleted_at = datetime('now'), updated_at = datetime('now')
        WHERE deleted_at IS NULL
          AND is_pinned = 0
          AND importance_score < ?
          AND COALESCE(last_accessed_at, created_at) < datetime('now', '-' || ? || ' days')
      `,
      )
      .run(maxImportance, maxAgeDays)

    return result.changes
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  close(): void {
    if (this._db) {
      this._db.close()
      this._db = null
    }
  }
}
