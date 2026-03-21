import type { DatabaseService } from './database-service'
import type { MemoryInsert } from './types'

/**
 * Memory extractors run after a session completes (task_complete) and
 * create/supersede derived memories beyond the basic session_outcome.
 *
 * Each extractor is idempotent: it checks for existing memories before
 * inserting and supersedes stale entries with updated stats.
 */

// ── file_pattern extractor ──────────────────────────────────────────────

/**
 * Creates `file_pattern` memories for files that have been touched >= 5 times
 * across >= 2 sessions in the same project — indicating a "hot file" the user
 * works on frequently.
 */
export function extractFilePatterns(
  db: DatabaseService,
  projectId: string,
  sessionId: string,
): void {
  const hotFiles = db.db
    .prepare(
      `
      SELECT ft.path, COUNT(*) as touch_count, COUNT(DISTINCT ft.session_id) as session_count,
             GROUP_CONCAT(DISTINCT ft.action) as actions
      FROM files_touched ft
      JOIN sessions s ON s.id = ft.session_id
      WHERE s.project_id = ? AND ft.deleted_at IS NULL AND s.deleted_at IS NULL
      GROUP BY ft.path
      HAVING touch_count >= 5 AND session_count >= 2
    `,
    )
    .all(projectId) as Array<{
    path: string
    touch_count: number
    session_count: number
    actions: string
  }>

  for (const file of hotFiles) {
    const existing = db.db
      .prepare(
        `
        SELECT id FROM memories
        WHERE project_id = ? AND memory_type = 'file_pattern' AND title = ? AND deleted_at IS NULL
      `,
      )
      .get(projectId, file.path) as { id: string } | undefined

    const memory: MemoryInsert = {
      projectId,
      sessionId,
      memoryType: 'file_pattern',
      scope: 'project',
      title: file.path,
      body: `Frequently edited file: ${file.touch_count} touches across ${file.session_count} sessions. Actions: ${file.actions}`,
      sourceRefsJson: null,
      importanceScore: Math.min(0.9, 0.5 + file.touch_count * 0.02),
      confidenceScore: 1.0,
    }

    if (existing) {
      db.supersedeMemory(existing.id, memory)
    } else {
      db.insertMemory(memory)
    }
  }
}

// ── error_pattern extractor ─────────────────────────────────────────────

/**
 * Creates `error_pattern` memories for error messages that appear >= 3 times
 * across the project's sessions — indicating recurring problems.
 */
export function extractErrorPatterns(
  db: DatabaseService,
  projectId: string,
  sessionId: string,
): void {
  const errors = db.db
    .prepare(
      `
      SELECT json_extract(e.payload_json, '$.message') as error_msg, COUNT(*) as count
      FROM events e
      JOIN sessions s ON s.id = e.session_id
      WHERE s.project_id = ? AND e.event_type = 'error' AND e.deleted_at IS NULL AND s.deleted_at IS NULL
        AND json_extract(e.payload_json, '$.message') IS NOT NULL
      GROUP BY error_msg
      HAVING count >= 3
    `,
    )
    .all(projectId) as Array<{ error_msg: string; count: number }>

  for (const err of errors) {
    const title = err.error_msg.substring(0, 100)
    const existing = db.db
      .prepare(
        `
        SELECT id FROM memories
        WHERE project_id = ? AND memory_type = 'error_pattern' AND title = ? AND deleted_at IS NULL
      `,
      )
      .get(projectId, title) as { id: string } | undefined

    const memory: MemoryInsert = {
      projectId,
      sessionId,
      memoryType: 'error_pattern',
      scope: 'project',
      title,
      body: `Recurring error (${err.count} occurrences): ${err.error_msg}`,
      sourceRefsJson: null,
      importanceScore: Math.min(0.8, 0.4 + err.count * 0.05),
      confidenceScore: 1.0,
    }

    if (existing) {
      db.supersedeMemory(existing.id, memory)
    } else {
      db.insertMemory(memory)
    }
  }
}

// ── tool_preference extractor ───────────────────────────────────────────

/**
 * Creates a single `tool_preference` memory per project summarizing the
 * tool usage distribution (top 5 tools by call count).
 */
export function extractToolPreferences(
  db: DatabaseService,
  projectId: string,
  sessionId: string,
): void {
  const tools = db.db
    .prepare(
      `
      SELECT json_extract(e.payload_json, '$.toolName') as tool_name, COUNT(*) as count
      FROM events e
      JOIN sessions s ON s.id = e.session_id
      WHERE s.project_id = ? AND e.event_type = 'tool_call' AND e.deleted_at IS NULL AND s.deleted_at IS NULL
        AND json_extract(e.payload_json, '$.toolName') IS NOT NULL
      GROUP BY tool_name
      ORDER BY count DESC
    `,
    )
    .all(projectId) as Array<{ tool_name: string; count: number }>

  if (tools.length === 0) return

  const total = tools.reduce((sum, t) => sum + t.count, 0)
  const distribution = tools
    .slice(0, 5)
    .map(
      (t) => `${t.tool_name} ${Math.round((t.count / total) * 100)}%`,
    )
    .join(', ')
  const title = 'Tool usage distribution'

  const existing = db.db
    .prepare(
      `
      SELECT id FROM memories
      WHERE project_id = ? AND memory_type = 'tool_preference' AND deleted_at IS NULL
    `,
    )
    .get(projectId) as { id: string } | undefined

  const memory: MemoryInsert = {
    projectId,
    sessionId,
    memoryType: 'tool_preference',
    scope: 'project',
    title,
    body: `Tool distribution (${total} total calls): ${distribution}`,
    sourceRefsJson: null,
    importanceScore: 0.4,
    confidenceScore: 1.0,
  }

  if (existing) {
    db.supersedeMemory(existing.id, memory)
  } else {
    db.insertMemory(memory)
  }
}
