// ── Smart Context Extractors ─────────────────────────────────────────────
// Run after session completion to extract decisions, pitfalls, and
// co-occurrence data for the smart context injection system.

import type { DatabaseService } from './database-service'
import { generateId } from './id'
import { extractKeyTokens } from './relevance-scorer'

// ── Decision patterns ────────────────────────────────────────────────────

const DECISION_PATTERNS = [
  /(?:chose|choosing|picked|selected|going with|decided on|will use|opted for)\s+(.{10,80})\s+(?:over|instead of|rather than)\s+(.{5,60})/gi,
  /(?:decision|approach|strategy|architecture):\s*(.{10,120})/gi,
  /(?:let's|we'll|I'll)\s+(?:use|go with|adopt|implement)\s+(.{10,80})\s+(?:for|because|since)/gi,
  /(?:decided to|decided on)\s+(.{10,120})/gi,
]

/**
 * Extract architectural decisions from assistant messages in a session.
 * Looks for patterns like "chose X over Y", "decided to", etc.
 */
export function extractDecisions(
  db: DatabaseService,
  projectId: string,
  sessionId: string,
): void {
  const messages = db.db
    .prepare(
      `SELECT content FROM messages
       WHERE session_id = ? AND role = 'assistant' AND deleted_at IS NULL
       ORDER BY seq_num`,
    )
    .all(sessionId) as Array<{ content: string | null }>

  for (const msg of messages) {
    if (!msg.content) continue

    for (const pattern of DECISION_PATTERNS) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(msg.content)) !== null) {
        const title = match[0].substring(0, 100)
        const body = match[0].substring(0, 300)

        // Deduplicate
        const existing = db.db
          .prepare(
            `SELECT id FROM decisions
             WHERE project_id = ? AND title = ? AND deleted_at IS NULL`,
          )
          .get(projectId, title)

        if (!existing) {
          db.db
            .prepare(
              `INSERT INTO decisions (id, project_id, session_id, title, body, importance_score)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(generateId(), projectId, sessionId, title, body, 0.7)
        }
      }
    }
  }
}

// ── Pitfall extraction ───────────────────────────────────────────────────

/**
 * Create pitfall entries from error events in completed sessions.
 * Only creates pitfalls if the session was completed (errors were resolved).
 */
export function extractPitfalls(
  db: DatabaseService,
  projectId: string,
  sessionId: string,
): void {
  // Only create pitfalls from completed sessions (errors were resolved)
  const session = db.db
    .prepare('SELECT status FROM sessions WHERE id = ?')
    .get(sessionId) as { status: string } | undefined

  if (!session || session.status !== 'completed') return

  const errors = db.db
    .prepare(
      `SELECT json_extract(payload_json, '$.message') as msg
       FROM events
       WHERE session_id = ? AND event_type = 'error' AND deleted_at IS NULL
         AND json_extract(payload_json, '$.message') IS NOT NULL`,
    )
    .all(sessionId) as Array<{ msg: string }>

  for (const err of errors) {
    const title = err.msg.substring(0, 100)

    const existing = db.db
      .prepare(
        `SELECT id, occurrence_count FROM pitfalls
         WHERE project_id = ? AND title = ? AND deleted_at IS NULL`,
      )
      .get(projectId, title) as
      | { id: string; occurrence_count: number }
      | undefined

    if (existing) {
      db.db
        .prepare(
          `UPDATE pitfalls SET occurrence_count = ?, last_seen_at = datetime('now')
           WHERE id = ?`,
        )
        .run(existing.occurrence_count + 1, existing.id)
    } else {
      db.db
        .prepare(
          `INSERT INTO pitfalls (id, project_id, session_id, title, body, importance_score)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          generateId(),
          projectId,
          sessionId,
          title,
          `Error encountered and resolved: ${err.msg}`,
          0.6,
        )
    }
  }
}

// ── Co-occurrence map ────────────────────────────────────────────────────

/**
 * Build/update term co-occurrence table from session messages.
 * Tracks which terms appear together, enabling query expansion
 * (e.g., "auth" → "JWT", "token", "login").
 */
export function buildCooccurrenceMap(
  db: DatabaseService,
  projectId: string,
  sessionId: string,
): void {
  const messages = db.db
    .prepare(
      `SELECT content FROM messages
       WHERE session_id = ? AND deleted_at IS NULL AND content IS NOT NULL
       ORDER BY seq_num`,
    )
    .all(sessionId) as Array<{ content: string }>

  if (messages.length === 0) return

  const allText = messages.map((m) => m.content).join(' ')
  const tokens = [...extractKeyTokens(allText)]

  // Limit to top 50 tokens to avoid combinatorial explosion
  const topTokens = tokens.slice(0, 50)

  if (topTokens.length < 2) return

  const upsert = db.db.prepare(
    `INSERT INTO term_cooccurrences (project_id, term_a, term_b, weight)
     VALUES (?, ?, ?, 1.0)
     ON CONFLICT(project_id, term_a, term_b) DO UPDATE SET weight = weight + 1.0`,
  )

  const batch = db.db.transaction(() => {
    for (let i = 0; i < topTokens.length; i++) {
      for (let j = i + 1; j < topTokens.length; j++) {
        // Insert both directions for O(1) lookup
        upsert.run(projectId, topTokens[i], topTokens[j])
        upsert.run(projectId, topTokens[j], topTokens[i])
      }
    }
  })

  batch()

  // Prune to keep only top terms by total weight
  pruneCooccurrences(db, projectId)
}

// ── Co-occurrence pruning ──────────────────────────────────────────────

/** Maximum unique terms (term_a values) to keep per project. */
const MAX_COOCCURRENCE_TERMS = 500

/**
 * Prune the term_cooccurrences table to cap at MAX_COOCCURRENCE_TERMS
 * unique terms per project, keeping those with the highest total weight.
 * Runs after each buildCooccurrenceMap call to prevent unbounded growth.
 */
export function pruneCooccurrences(
  db: DatabaseService,
  projectId: string,
): void {
  const termCount = db.db
    .prepare(
      `SELECT COUNT(DISTINCT term_a) as cnt
       FROM term_cooccurrences WHERE project_id = ?`,
    )
    .get(projectId) as { cnt: number }

  if (termCount.cnt <= MAX_COOCCURRENCE_TERMS) return

  // Find the top terms by total weight
  const topTerms = db.db
    .prepare(
      `SELECT term_a, SUM(weight) as total_weight
       FROM term_cooccurrences
       WHERE project_id = ?
       GROUP BY term_a
       ORDER BY total_weight DESC
       LIMIT ?`,
    )
    .all(projectId, MAX_COOCCURRENCE_TERMS) as Array<{ term_a: string }>

  const keepSet = new Set(topTerms.map((t) => t.term_a))
  const placeholders = topTerms.map(() => '?').join(',')

  db.db
    .prepare(
      `DELETE FROM term_cooccurrences
       WHERE project_id = ?
         AND (term_a NOT IN (${placeholders}) OR term_b NOT IN (${placeholders}))`,
    )
    .run(projectId, ...keepSet, ...keepSet)
}
