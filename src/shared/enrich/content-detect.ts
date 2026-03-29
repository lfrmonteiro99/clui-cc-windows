/**
 * ENRICH-002: Content-Type Detection Badge
 *
 * Detects what kind of content Claude is writing (code, list, table, etc.)
 * from streaming text and returns a human-readable activity label.
 */

export type ContentType = 'code' | 'list' | 'table' | 'structure' | 'prose'

export interface ContentDetection {
  type: ContentType
  label: string
}

const CODE_FENCE_RE = /```\w*/
const NUMBERED_LIST_RE = /^\s*\d+\.\s+/m
const BULLET_LIST_RE = /^\s*[-*]\s+/m
const TABLE_RE = /\|[^|]+\|/
const HEADER_RE = /^#{1,6}\s+/m

/**
 * Detect what type of content is present in the given text.
 * Returns the most specific match found.
 */
export function detectContentType(text: string): ContentDetection {
  if (CODE_FENCE_RE.test(text)) {
    return { type: 'code', label: 'Writing code...' }
  }

  if (TABLE_RE.test(text)) {
    return { type: 'table', label: 'Generating table...' }
  }

  if (NUMBERED_LIST_RE.test(text)) {
    const steps = text.match(/^\s*\d+\.\s+/gm)
    const count = steps ? steps.length : 0
    return { type: 'list', label: `Listing steps (${count})...` }
  }

  if (BULLET_LIST_RE.test(text)) {
    const bullets = text.match(/^\s*[-*]\s+/gm)
    const count = bullets ? bullets.length : 0
    return { type: 'list', label: `Listing items (${count})...` }
  }

  if (HEADER_RE.test(text)) {
    return { type: 'structure', label: 'Structuring response...' }
  }

  return { type: 'prose', label: 'Writing...' }
}

/**
 * Throttled content detection: only runs detection when chunkIndex is
 * a multiple of `interval` (default 5). Returns null on skipped chunks.
 */
export function throttledDetect(
  text: string,
  chunkIndex: number,
  interval = 5,
): ContentDetection | null {
  if (chunkIndex % interval !== 0) return null
  return detectContentType(text)
}
