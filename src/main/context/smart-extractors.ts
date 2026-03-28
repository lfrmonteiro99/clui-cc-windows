// ── Smart Context Extractors ─────────────────────────────────────────────
// Run after session completion to extract decisions, pitfalls, and
// co-occurrence data for the smart context injection system.

import type { DatabaseService } from './database-service'
import { generateId } from './id'
import { extractKeyTokens } from './relevance-scorer'

// ── Decision patterns ────────────────────────────────────────────────────

const DECISION_PATTERNS = [
  // Existing patterns
  /(?:chose|choosing|picked|selected|going with|decided on|will use|opted for)\s+(.{10,80})\s+(?:over|instead of|rather than)\s+(.{5,60})/gi,
  /(?:decision|approach|strategy|architecture):\s*(.{10,120})/gi,
  /(?:let's|we'll|I'll)\s+(?:use|go with|adopt|implement)\s+(.{10,80})\s+(?:for|because|since)/gi,
  /(?:decided to|decided on)\s+(.{10,120})/gi,
  // New patterns (CTX-006)
  /(?:we should|you should)\s+(?:use|adopt|implement|try)\s+(.{3,80})/gi,
  /let's go with\s+(.{3,80})/gi,
  /the (?:approach|plan|strategy|method) will be\s+(.{3,80})/gi,
  /I recommend\s+(.{3,80})/gi,
  /(?:switched|migrated|moved|transitioned) from\s+(.{3,40})\s+to\s+(.{3,40})/gi,
  /(?:it's |it is )?better to (?:use|adopt|implement)\s+(.{3,80})/gi,
]

/** Maximum decisions to extract per session. */
const MAX_DECISIONS_PER_SESSION = 8

/** Minimum match length to avoid false positives. */
const MIN_DECISION_LENGTH = 20

/**
 * Pattern for detecting concrete nouns — capitalized words, technical terms,
 * or words containing digits/hyphens that suggest a specific technology or concept.
 */
const CONCRETE_NOUN_RE = /[A-Z][a-zA-Z]+|[a-z]+[-_][a-z]+|[a-z]*\d+[a-z]*|(?:api|cli|orm|sdk|tdd|css|sql|jwt|ssr|ssr|esm|cjs)\b/i

/**
 * Compute Jaccard similarity between two strings based on word tokens.
 * Returns a value between 0 (no overlap) and 1 (identical token sets).
 */
function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))

  if (tokensA.size === 0 && tokensB.size === 0) return 1

  let intersection = 0
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++
  }

  const union = tokensA.size + tokensB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Check whether two decision texts are duplicates using Jaccard similarity.
 * A threshold of >0.6 word overlap means they express the same decision.
 */
export function isDuplicateDecision(a: string, b: string): boolean {
  return jaccardSimilarity(a, b) > 0.6
}

/**
 * Check whether a matched decision text contains a concrete noun
 * (technology name, acronym, etc.) to avoid false positives like "let's go".
 */
function hasConcreteNoun(text: string): boolean {
  return CONCRETE_NOUN_RE.test(text)
}

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

  // Track decisions inserted in this session for Jaccard dedup and cap
  const sessionDecisionTitles: string[] = []

  // Also load existing decisions for this project for cross-session dedup
  const existingDecisions = db.db
    .prepare(
      `SELECT title FROM decisions
       WHERE project_id = ? AND deleted_at IS NULL`,
    )
    .all(projectId) as Array<{ title: string }>
  const existingTitles = existingDecisions.map((d) => d.title)

  for (const msg of messages) {
    if (!msg.content) continue

    for (const pattern of DECISION_PATTERNS) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(msg.content)) !== null) {
        // Enforce session cap
        if (sessionDecisionTitles.length >= MAX_DECISIONS_PER_SESSION) break

        const fullMatch = match[0]

        // Min length check to avoid false positives
        if (fullMatch.length < MIN_DECISION_LENGTH) continue

        // Concrete noun check to avoid vague matches like "let's go"
        if (!hasConcreteNoun(fullMatch)) continue

        const title = fullMatch.substring(0, 100)
        const body = fullMatch.substring(0, 300)

        // Exact title dedup (existing behavior)
        const exactDup = existingTitles.includes(title) ||
          sessionDecisionTitles.includes(title)
        if (exactDup) continue

        // Jaccard similarity dedup against existing + session decisions
        const allKnownTitles = [...existingTitles, ...sessionDecisionTitles]
        const isSimilarDup = allKnownTitles.some((t) => isDuplicateDecision(title, t))
        if (isSimilarDup) continue

        db.db
          .prepare(
            `INSERT INTO decisions (id, project_id, session_id, title, body, importance_score)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(generateId(), projectId, sessionId, title, body, 0.7)

        sessionDecisionTitles.push(title)
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
