/**
 * Simple keyword extraction for cross-tab deduplication radar.
 * No NLP libraries — just tokenization, stop-word removal, and frequency ranking.
 */

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'just', 'because', 'but', 'and', 'or', 'if', 'while',
  'about', 'up', 'out', 'off', 'over', 'also', 'this', 'that', 'these',
  'those', 'it', 'its', 'my', 'your', 'his', 'her', 'our', 'their',
  'what', 'which', 'who', 'whom', 'me', 'him', 'them', 'we', 'you',
  'i', 'he', 'she', 'they', 'please', 'thanks', 'thank', 'yes', 'yeah',
  'sure', 'okay', 'ok', 'like', 'make', 'use', 'get', 'set', 'let',
])

/**
 * Extract meaningful keywords from text.
 * Returns deduplicated keywords sorted by frequency, max 20.
 */
export function extractKeywords(text: string): string[] {
  if (!text || text.trim().length === 0) return []

  // Tokenize: split on whitespace and punctuation (keep file-path-like tokens)
  const tokens = text
    .toLowerCase()
    .replace(/[`'"{}()[\]<>,;:!?]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  // Count frequencies, excluding stop words and short tokens
  const freq = new Map<string, number>()
  for (const token of tokens) {
    // Remove leading/trailing dots and slashes for cleaner keywords
    const clean = token.replace(/^[./\\]+|[./\\]+$/g, '')
    if (clean.length < 3) continue
    if (STOP_WORDS.has(clean)) continue
    // Skip pure numbers
    if (/^\d+$/.test(clean)) continue

    freq.set(clean, (freq.get(clean) || 0) + 1)
  }

  // Sort by frequency (descending), take top 20
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word)
}

/**
 * Compute keyword overlap score between a query's keywords and a tab's keywords.
 * Returns a value between 0 and 1.
 */
export function keywordOverlapScore(queryKeywords: string[], tabKeywords: string[]): number {
  if (queryKeywords.length === 0 || tabKeywords.length === 0) return 0

  const tabSet = new Set(tabKeywords)
  let matches = 0
  for (const kw of queryKeywords) {
    if (tabSet.has(kw)) matches++
  }

  // Jaccard-like score: matches / min(query, tab) to bias toward query coverage
  return matches / Math.min(queryKeywords.length, tabKeywords.length)
}
