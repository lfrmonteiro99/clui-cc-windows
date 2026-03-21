// ── Smart Context Relevance Scoring ──────────────────────────────────────
// Computes composite relevance scores for context items to determine
// which items should be included in the smart memory packet.

export { ContextTier } from './types'

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'this', 'that', 'it', 'i', 'you',
  'we', 'they', 'my', 'your', 'our', 'and', 'or', 'but', 'not', 'if',
  'then', 'than', 'so', 'up', 'out', 'about', 'into', 'just', 'also',
  'like', 'make', 'get', 'use', 'want', 'need', 'try', 'let', 'please',
])

// ── Scoring weights ──────────────────────────────────────────────────────

interface ScoringWeights {
  recency: number
  importance: number
  promptMatch: number
  fileOverlap: number
  accessFrequency: number
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  recency: 0.25,
  importance: 0.25,
  promptMatch: 0.30,
  fileOverlap: 0.15,
  accessFrequency: 0.05,
}

// ── Input types ──────────────────────────────────────────────────────────

export interface RawContextItem {
  updatedAt: string
  importanceScore: number
  searchableText: string
  associatedFiles: string[]
  accessCount: number
}

export interface ProjectState {
  gitDiffFiles: string[]
  recentlyOpenedFiles: string[]
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Exponential time decay with configurable half-life and minimum floor.
 */
export function decayScore(
  timestamp: string,
  halfLifeHours: number,
  floor: number,
): number {
  const hoursAgo = (Date.now() - new Date(timestamp).getTime()) / 3_600_000
  return Math.max(Math.pow(0.5, hoursAgo / halfLifeHours), floor)
}

/**
 * Extract meaningful tokens from text, filtering stopwords and short tokens.
 */
export function extractKeyTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_\-/.]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  )
}

/**
 * Compute prompt-to-item text similarity using Jaccard token overlap.
 */
export function computePromptMatch(
  itemText: string,
  prompt: string,
): number {
  const promptTokens = extractKeyTokens(prompt)
  const itemTokens = extractKeyTokens(itemText)

  if (promptTokens.size === 0) return 0

  let overlap = 0
  for (const t of promptTokens) {
    if (itemTokens.has(t)) overlap++
  }

  if (overlap === 0) return 0

  const jaccard =
    overlap / (promptTokens.size + itemTokens.size - overlap)

  return Math.min(1.0, jaccard)
}

/**
 * Compute file overlap between a memory's associated files and current project hot files.
 */
export function computeFileOverlap(
  memoryFiles: string[],
  gitDiffFiles: string[],
  recentFiles: string[],
): number {
  if (memoryFiles.length === 0) return 0
  const hotSet = new Set([...gitDiffFiles, ...recentFiles])
  if (hotSet.size === 0) return 0
  let hits = 0
  for (const f of memoryFiles) {
    if (hotSet.has(f)) hits++
  }
  return Math.min(1.0, hits / memoryFiles.length)
}

/**
 * Compute a composite relevance score for a context item.
 */
export function scoreItem(
  item: RawContextItem,
  prompt: string,
  projectState: ProjectState,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): number {
  const recency = decayScore(item.updatedAt, 48, 0.05)
  const importance = item.importanceScore
  const promptMatch = computePromptMatch(item.searchableText, prompt)
  const fileOverlap = computeFileOverlap(
    item.associatedFiles,
    projectState.gitDiffFiles,
    projectState.recentlyOpenedFiles,
  )
  const accessFreq = Math.min(item.accessCount / 20, 1.0)

  return (
    weights.recency * recency +
    weights.importance * importance +
    weights.promptMatch * promptMatch +
    weights.fileOverlap * fileOverlap +
    weights.accessFrequency * accessFreq
  )
}
