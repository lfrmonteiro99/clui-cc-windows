/**
 * ENRICH-006: Live Mini-TOC
 *
 * Parses markdown headings from streaming text to build a table of contents.
 */

export interface OutlineEntry {
  level: number
  text: string
  offset: number
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/gm

/**
 * Parse all markdown headings from the given text.
 * Returns entries with their level (1-6), text, and character offset.
 */
export function parseOutline(text: string): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(HEADING_RE.source, HEADING_RE.flags)
  while ((match = re.exec(text)) !== null) {
    entries.push({
      level: match[1].length,
      text: match[2].trim(),
      offset: match.index,
    })
  }
  return entries
}

/**
 * Detect step progress from numbered lists.
 * Returns { current, total } where current is the last numbered step found
 * and total is an estimate based on patterns like "N steps" in the text.
 */
export function detectStepProgress(text: string): { current: number; total: number | null } {
  const steps = text.match(/^\s*(\d+)\.\s+/gm)
  if (!steps || steps.length === 0) {
    return { current: 0, total: null }
  }

  // Find the highest step number
  let maxStep = 0
  for (const step of steps) {
    const num = parseInt(step.trim(), 10)
    if (num > maxStep) maxStep = num
  }

  // Try to find a total from text like "5 steps" or "follow these 5 steps"
  const totalMatch = text.match(/(\d+)\s+steps/i)
  const total = totalMatch ? parseInt(totalMatch[1], 10) : null

  return { current: maxStep, total }
}
