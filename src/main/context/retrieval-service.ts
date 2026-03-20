import type { DatabaseService } from './database-service'
import type {
  MemoryPacketConfig,
  MemorySearchResult,
  ProjectRow,
} from './types'
import { DEFAULT_MEMORY_PACKET_CONFIG } from './types'

// ── Raw row types from custom queries ────────────────────────────────────

interface RecentSessionRow {
  id: string
  title: string | null
  goal: string | null
  status: string
  started_at: string
  ended_at: string | null
  summary: string | null
}

interface SessionFileRow {
  path: string
  action: string
}

interface SessionToolRow {
  tool_name: string
}

interface MemoryRow {
  id: string
  memory_type: string
  scope: string
  title: string
  body: string | null
  importance_score: number
  confidence_score: number
  is_pinned: number
  access_count: number
  created_at: string
  updated_at: string
}

interface ActiveFileRow {
  path: string
  touch_count: number
  session_count: number
  actions: string
  last_touched: string
}

// ── Helpers ──────────────────────────────────────────────────────────────

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4)
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const remainder = s % 60
  return remainder > 0 ? `${m}m${remainder}s` : `${m}m`
}

/**
 * Sanitize a user prompt for FTS5 MATCH.
 * FTS5 interprets special characters (*, ", OR, AND, NOT, etc.) as operators.
 * We strip them and wrap each token in double quotes for exact matching.
 */
function sanitizeFtsQuery(query: string): string {
  // Remove characters that FTS5 treats as operators or syntax
  const cleaned = query.replace(/[*"():^{}[\]~\\<>]/g, ' ')
  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t.length > 0)
    // Remove FTS5 keywords
    .filter((t) => !['AND', 'OR', 'NOT', 'NEAR'].includes(t.toUpperCase()))
  if (tokens.length === 0) return ''
  // Quote each token individually to prevent FTS5 operator interpretation
  return tokens.map((t) => `"${t}"`).join(' ')
}

// ── RetrievalService ─────────────────────────────────────────────────────

export class RetrievalService {
  private readonly dbService: DatabaseService

  constructor(db: DatabaseService) {
    this.dbService = db
  }

  /**
   * Resolve a filesystem path to its project ID in the database.
   * Uses the same normalization as DatabaseService.
   */
  resolveProjectId(projectPath: string): string | null {
    const project = this.dbService.getProjectByPath(projectPath)
    return project ? project.id : null
  }

  /**
   * Assemble an XML-tagged context block for prompt injection.
   * Returns null if no relevant data found for the project.
   */
  buildMemoryPacket(
    projectId: string,
    _tabId: string,
    prompt: string,
    config: MemoryPacketConfig = DEFAULT_MEMORY_PACKET_CONFIG,
  ): string | null {
    const db = this.dbService.db

    // ── 1. Project header (never trimmed) ──────────────────────────────
    const project = db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(projectId) as ProjectRow | undefined

    if (!project) return null

    const stats = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM sessions WHERE project_id = ? AND deleted_at IS NULL) as session_count,
          (SELECT COUNT(DISTINCT ft.path) FROM files_touched ft
           JOIN sessions s ON s.id = ft.session_id
           WHERE s.project_id = ? AND ft.deleted_at IS NULL AND s.deleted_at IS NULL) as unique_files_touched,
          (SELECT MAX(s.started_at) FROM sessions s WHERE s.project_id = ? AND s.deleted_at IS NULL) as last_active_at`,
      )
      .get(projectId, projectId, projectId) as {
      session_count: number
      unique_files_touched: number
      last_active_at: string | null
    }

    // If no sessions and no data at all, return null
    if (stats.session_count === 0) return null

    const projectSection = this.buildProjectSection(project, stats)

    // ── 2. Recent sessions ──────────────────────────────────────────────
    const sessionRows = db
      .prepare(
        `SELECT s.id, s.title, s.goal, s.status, s.started_at, s.ended_at,
                ss.body as summary
         FROM sessions s
         LEFT JOIN session_summaries ss ON ss.session_id = s.id AND ss.summary_kind = 'technical'
         WHERE s.project_id = ? AND s.deleted_at IS NULL AND s.status IN ('completed', 'dead')
         ORDER BY s.ended_at DESC LIMIT ?`,
      )
      .all(projectId, config.maxRecentSessions) as RecentSessionRow[]

    const sessionsSection = this.buildSessionsSection(db, sessionRows, config)

    // ── 3. Relevant memories ────────────────────────────────────────────
    const memoryRows = this.queryMemories(
      db,
      projectId,
      prompt,
      config.maxMemories,
      config.minImportanceScore,
    )

    const memoriesSection = this.buildMemoriesSection(memoryRows)

    // ── 4. Active files ─────────────────────────────────────────────────
    const activeFileRows = db
      .prepare(
        `SELECT ft.path, COUNT(*) as touch_count,
                COUNT(DISTINCT ft.session_id) as session_count,
                GROUP_CONCAT(DISTINCT ft.action) as actions,
                MAX(ft.created_at) as last_touched
         FROM files_touched ft JOIN sessions s ON ft.session_id = s.id
         WHERE s.project_id = ? AND ft.deleted_at IS NULL
         GROUP BY ft.path ORDER BY touch_count DESC, last_touched DESC LIMIT ?`,
      )
      .all(projectId, config.maxActiveFiles) as ActiveFileRow[]

    const filesSection = this.buildFilesSection(activeFileRows)

    // ── 5. Token budget enforcement ─────────────────────────────────────
    const sections = {
      project: projectSection,
      sessions: sessionsSection,
      memories: memoriesSection,
      files: filesSection,
    }

    const packet = this.enforceTokenBudget(
      sections,
      config,
      db,
      projectId,
      prompt,
      sessionRows,
      memoryRows,
      activeFileRows,
    )

    // ── 6. Track memory access ──────────────────────────────────────────
    if (memoryRows.length > 0) {
      const ids = memoryRows.map((m) => m.id)
      const placeholders = ids.map(() => '?').join(', ')
      db.prepare(
        `UPDATE memories SET access_count = access_count + 1, last_accessed_at = datetime('now')
         WHERE id IN (${placeholders})`,
      ).run(...ids)
    }

    return packet
  }

  /**
   * Full-text search for memories (for UI display, not packet assembly).
   */
  searchMemories(
    projectId: string,
    query: string,
    limit: number,
  ): MemorySearchResult[] {
    const db = this.dbService.db

    const ftsQuery = sanitizeFtsQuery(query)
    if (ftsQuery) {
      try {
        const rows = db
          .prepare(
            `SELECT m.id, m.memory_type, m.scope, m.title, m.body, m.importance_score,
                    m.confidence_score, m.is_pinned, m.access_count, m.created_at, m.updated_at
             FROM memories m
             JOIN memory_fts ON memory_fts.rowid = m.rowid
             WHERE m.project_id = ? AND m.deleted_at IS NULL
               AND memory_fts MATCH ?
             ORDER BY m.is_pinned DESC, rank * m.importance_score DESC
             LIMIT ?`,
          )
          .all(projectId, ftsQuery, limit) as MemoryRow[]

        return rows.map(this.toMemorySearchResult)
      } catch {
        // FTS query failed, fall through to fallback
      }
    }

    // Fallback: no query or FTS failed
    const rows = db
      .prepare(
        `SELECT m.id, m.memory_type, m.scope, m.title, m.body, m.importance_score,
                m.confidence_score, m.is_pinned, m.access_count, m.created_at, m.updated_at
         FROM memories m
         WHERE m.project_id = ? AND m.deleted_at IS NULL
         ORDER BY m.is_pinned DESC, m.importance_score DESC, m.updated_at DESC
         LIMIT ?`,
      )
      .all(projectId, limit) as MemoryRow[]

    return rows.map(this.toMemorySearchResult)
  }

  // ── Private: Section builders ──────────────────────────────────────────

  private buildProjectSection(
    project: ProjectRow,
    stats: {
      session_count: number
      unique_files_touched: number
      last_active_at: string | null
    },
  ): string {
    const lastActive = stats.last_active_at
      ? stats.last_active_at.split(' ')[0]
      : 'N/A'

    return `<project name="${project.name}" path="${project.root_path}">
Last active: ${lastActive}
Sessions: ${stats.session_count} | Files touched: ${stats.unique_files_touched} unique paths
</project>`
  }

  private buildSessionsSection(
    db: any,
    sessionRows: RecentSessionRow[],
    config: MemoryPacketConfig,
  ): string {
    if (sessionRows.length === 0) return ''

    const sessionEntries = sessionRows.map((s) => {
      // Get files for this session
      const files = db
        .prepare(
          `SELECT DISTINCT path, action FROM files_touched
           WHERE session_id = ? AND deleted_at IS NULL`,
        )
        .all(s.id) as SessionFileRow[]

      // Get tools for this session
      const tools = db
        .prepare(
          `SELECT DISTINCT
             CASE
               WHEN payload_json IS NOT NULL THEN json_extract(payload_json, '$.toolName')
               ELSE event_type
             END as tool_name
           FROM events
           WHERE session_id = ? AND event_type IN ('tool_call', 'tool_call_complete') AND deleted_at IS NULL`,
        )
        .all(s.id) as SessionToolRow[]

      const date = s.ended_at
        ? s.ended_at.split(' ')[0]
        : s.started_at.split(' ')[0]
      let durationStr = ''
      if (s.started_at && s.ended_at) {
        const ms =
          new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()
        if (ms > 0) durationStr = ` duration="${formatDuration(ms)}"`
      }

      // Get user prompts for this session (key context)
      const userMessages = db
        .prepare(
          `SELECT substr(content, 1, 200) as content FROM messages
           WHERE session_id = ? AND role = 'user' AND deleted_at IS NULL
           ORDER BY seq_num LIMIT 5`,
        )
        .all(s.id) as Array<{ content: string }>

      const goal = s.goal || s.title || 'N/A'
      const fileList =
        files.length > 0
          ? files.map((f) => `${f.path} (${f.action})`).join(', ')
          : 'none'
      const toolList =
        tools.length > 0
          ? tools
              .map((t) => t.tool_name)
              .filter(Boolean)
              .join(', ')
          : 'none'
      const summary = s.summary || 'No summary available.'
      const userPromptsStr = userMessages.length > 0
        ? userMessages.map((m) => m.content).join(' | ')
        : 'N/A'

      return `<session id="${s.id}" date="${date}" status="${s.status}"${durationStr}>
Goal: ${goal}
User prompts: ${userPromptsStr}
Files: ${fileList}
Tools: ${toolList}
Summary: ${summary}
</session>`
    })

    return `<recent_sessions max="${config.maxRecentSessions}">
${sessionEntries.join('\n')}
</recent_sessions>`
  }

  private buildMemoriesSection(memoryRows: MemoryRow[]): string {
    if (memoryRows.length === 0) return ''

    const entries = memoryRows.map((m) => {
      const created = m.created_at.split(' ')[0]
      const content = m.body || m.title
      return `<memory type="${m.memory_type}" importance="${m.importance_score}" created="${created}">
${content}
</memory>`
    })

    return `<relevant_memories count="${memoryRows.length}">
${entries.join('\n')}
</relevant_memories>`
  }

  private buildFilesSection(activeFileRows: ActiveFileRow[]): string {
    if (activeFileRows.length === 0) return ''

    const entries = activeFileRows.map((f) => {
      const actions = f.actions ? f.actions.split(',') : []
      const parts: string[] = []
      for (const action of actions) {
        // Count how many of this action (approximate from total)
        parts.push(action)
      }
      const sessionLabel =
        f.session_count === 1
          ? '1 session'
          : `${f.session_count} sessions`
      return `${f.path} — ${parts.join(', ')} ${f.touch_count} times across ${sessionLabel}`
    })

    return `<active_files count="${activeFileRows.length}">
${entries.join('\n')}
</active_files>`
  }

  // ── Private: Memory queries ────────────────────────────────────────────

  private queryMemories(
    db: any,
    projectId: string,
    prompt: string,
    limit: number,
    minImportance: number,
  ): MemoryRow[] {
    // Try FTS search first if there's a prompt
    if (prompt && prompt.trim().length > 0) {
      const ftsQuery = sanitizeFtsQuery(prompt)
      if (ftsQuery) {
        try {
          const rows = db
            .prepare(
              `SELECT m.id, m.memory_type, m.scope, m.title, m.body, m.importance_score,
                      m.confidence_score, m.is_pinned, m.access_count, m.created_at, m.updated_at
               FROM memories m
               JOIN memory_fts ON memory_fts.rowid = m.rowid
               WHERE m.project_id = ? AND m.deleted_at IS NULL AND m.importance_score >= ?
                 AND memory_fts MATCH ?
               ORDER BY m.is_pinned DESC, rank * m.importance_score DESC
               LIMIT ?`,
            )
            .all(projectId, minImportance, ftsQuery, limit) as MemoryRow[]

          if (rows.length > 0) return rows
        } catch {
          // FTS failed, fall through to fallback
        }
      }
    }

    // Fallback: importance + recency
    return db
      .prepare(
        `SELECT m.id, m.memory_type, m.scope, m.title, m.body, m.importance_score,
                m.confidence_score, m.is_pinned, m.access_count, m.created_at, m.updated_at
         FROM memories m
         WHERE m.project_id = ? AND m.deleted_at IS NULL AND m.importance_score >= ?
         ORDER BY m.is_pinned DESC, m.importance_score DESC, m.updated_at DESC
         LIMIT ?`,
      )
      .all(projectId, minImportance, limit) as MemoryRow[]
  }

  // ── Private: Token budget enforcement ──────────────────────────────────

  private enforceTokenBudget(
    sections: {
      project: string
      sessions: string
      memories: string
      files: string
    },
    config: MemoryPacketConfig,
    db: any,
    projectId: string,
    prompt: string,
    sessionRows: RecentSessionRow[],
    memoryRows: MemoryRow[],
    activeFileRows: ActiveFileRow[],
  ): string {
    const wrap = (s: typeof sections) => {
      const parts = ['<clui_context>', s.project]
      if (s.sessions) parts.push(s.sessions)
      if (s.memories) parts.push(s.memories)
      if (s.files) parts.push(s.files)
      parts.push('</clui_context>')
      return parts.join('\n\n')
    }

    let result = wrap(sections)
    let tokens = estimateTokens(result)

    if (tokens <= config.maxTokens) return result

    // Priority 1: Trim active files (reduce count)
    let fileCount = activeFileRows.length
    while (tokens > config.maxTokens && fileCount > 0) {
      fileCount--
      const trimmedFiles = this.buildFilesSection(
        activeFileRows.slice(0, fileCount),
      )
      result = wrap({ ...sections, files: trimmedFiles })
      tokens = estimateTokens(result)
    }

    if (tokens <= config.maxTokens) return result

    // Priority 2: Trim memories (reduce count from bottom / lowest scoring)
    let memoryCount = memoryRows.length
    while (tokens > config.maxTokens && memoryCount > 0) {
      memoryCount--
      const trimmedMemories = this.buildMemoriesSection(
        memoryRows.slice(0, memoryCount),
      )
      result = wrap({ ...sections, files: '', memories: trimmedMemories })
      tokens = estimateTokens(result)
    }

    if (tokens <= config.maxTokens) return result

    // Priority 3: Trim sessions (reduce count, oldest first — they're already ordered newest first)
    let sessionCount = sessionRows.length
    while (tokens > config.maxTokens && sessionCount > 0) {
      sessionCount--
      const trimmedSessions = this.buildSessionsSection(
        db,
        sessionRows.slice(0, sessionCount),
        config,
      )
      result = wrap({
        ...sections,
        files: '',
        memories: '',
        sessions: trimmedSessions,
      })
      tokens = estimateTokens(result)
    }

    return result
  }

  // ── Private: Row to result mapping ─────────────────────────────────────

  private toMemorySearchResult(row: MemoryRow): MemorySearchResult {
    return {
      id: row.id,
      memoryType: row.memory_type,
      scope: row.scope,
      title: row.title,
      body: row.body,
      importanceScore: row.importance_score,
      confidenceScore: row.confidence_score,
      isPinned: row.is_pinned === 1,
      accessCount: row.access_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}
