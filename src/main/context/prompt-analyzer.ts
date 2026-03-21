// ── Prompt Signal Analysis ───────────────────────────────────────────────
// Analyzes the user's first prompt in a new session to extract signals
// that drive context selection: intent, continuation, file mentions, etc.

import { extractKeyTokens } from './relevance-scorer'
import type { PromptSignals } from './types'

// ── Public helpers (exported for testing) ────────────────────────────────

/**
 * Classify the user's intent from the prompt text.
 */
export function classifyIntent(prompt: string): PromptSignals['intent'] {
  const lower = prompt.toLowerCase()
  if (/\b(fix|bug|broken|error|crash\w*|issue|wrong|fail\w*)\b/.test(lower)) return 'fix'
  if (/\b(add|create|implement|build|new|feature)\b/.test(lower)) return 'feature'
  if (/\b(refactor|clean|reorganize|simplify|extract|rename)\b/.test(lower)) return 'refactor'
  if (/\b(pr|pull\s*request|diff|compare|review)\b/.test(lower)) return 'review'
  if (/\b(check|look\s*at|explain|what|why|how)\b/.test(lower)) return 'question'
  return 'general'
}

/**
 * Detect whether the prompt indicates continuation of previous work.
 */
export function detectContinuation(prompt: string): boolean {
  const continuationMarkers = [
    /continu/i,
    /where.*left.*off/i,
    /pick.*up/i,
    /finish/i,
    /last.*time/i,
    /earlier/i,
    /previous/i,
    /still.*need/i,
    /back.*to/i,
    /resume/i,
    /same.*thing/i,
  ]
  return continuationMarkers.some((r) => r.test(prompt))
}

/**
 * Extract file path-like strings from prompt text.
 */
export function extractFilePathsFromText(prompt: string): string[] {
  const pathPattern =
    /(?:^|\s)((?:\.\/|src\/|lib\/|test\/|tests\/|[\w-]+\/)+[\w.-]+\.\w+)/g
  const matches: string[] = []
  let m: RegExpExecArray | null
  while ((m = pathPattern.exec(prompt)) !== null) {
    matches.push(m[1])
  }
  return [...new Set(matches)]
}

// ── PromptAnalyzer class ─────────────────────────────────────────────────

export class PromptAnalyzer {
  private readonly db: any | null

  constructor(db: any | null) {
    this.db = db
  }

  /**
   * Analyze a prompt and return structured signals for context selection.
   */
  analyze(prompt: string, projectId: string): PromptSignals {
    const keyTerms = extractKeyTokens(prompt)
    const mentionedFiles = extractFilePathsFromText(prompt)
    const isContinuation = detectContinuation(prompt)
    const expandedTerms = this.expandTerms(keyTerms, projectId)
    const intent = classifyIntent(prompt)

    return { keyTerms, mentionedFiles, isContinuation, expandedTerms, intent }
  }

  /**
   * Expand terms using co-occurrence data from the database.
   * Returns original terms plus strongly co-occurring terms.
   */
  private expandTerms(terms: Set<string>, projectId: string): Set<string> {
    if (terms.size === 0 || !this.db) return new Set(terms)

    try {
      const termArray = [...terms]
      const placeholders = termArray.map(() => '?').join(',')
      const rows = this.db
        .prepare(
          `SELECT term_b, weight FROM term_cooccurrences
           WHERE project_id = ? AND term_a IN (${placeholders})
           ORDER BY weight DESC LIMIT 20`,
        )
        .all(projectId, ...termArray) as Array<{
        term_b: string
        weight: number
      }>

      const expanded = new Set(terms)
      for (const row of rows) {
        if (row.weight >= 3.0) {
          expanded.add(row.term_b)
        }
      }
      return expanded
    } catch {
      return new Set(terms)
    }
  }
}
