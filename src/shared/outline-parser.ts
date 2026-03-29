/**
 * outline-parser.ts — Pure functions to extract headers and step progress
 * from streaming markdown text for the live response outline / mini-TOC.
 */

export interface OutlineEntry {
  level: number       // 1 = ##, 2 = ###, 3 = ####
  text: string        // header text (cleaned of markdown)
  offset: number      // char offset in content (for scroll targeting)
  isActive: boolean   // last entry = currently being written
}

export interface StepProgress {
  current: number
  estimated: number   // estimated total based on density
}

const HEADER_RE = /^(#{1,4})\s+(.+)$/gm

/**
 * Scan markdown text for headers (# through ####) and return outline entries.
 * The last entry is marked as active (currently being written during streaming).
 */
export function parseOutline(text: string): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  let match: RegExpExecArray | null

  // Reset lastIndex for global regex
  HEADER_RE.lastIndex = 0

  while ((match = HEADER_RE.exec(text)) !== null) {
    const hashes = match[1]
    const rawText = match[2]
    entries.push({
      level: hashes.length,
      text: rawText.replace(/[*_`~]/g, '').trim(),
      offset: match.index,
      isActive: false,
    })
  }

  // Mark the last entry as active
  if (entries.length > 0) {
    entries[entries.length - 1].isActive = true
  }

  return entries
}

const STEP_RE = /^(\d+)\.\s/gm

/**
 * Detect numbered step progress (e.g., "1. First step", "2. Second step").
 * Returns current count and estimated total. Returns null if no numbered list found.
 */
export function detectStepProgress(text: string): StepProgress | null {
  const numbers: number[] = []

  STEP_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = STEP_RE.exec(text)) !== null) {
    numbers.push(parseInt(match[1], 10))
  }

  if (numbers.length === 0) return null

  const current = numbers.length
  const maxNumber = Math.max(...numbers)

  // Heuristic: if the highest numbered item equals the count, the list may still
  // be growing. Estimate ~current + 2 as the total. If maxNumber > current
  // (e.g., steps are numbered 1,2,5), use maxNumber as the estimate.
  const estimated = maxNumber > current ? maxNumber : current + 2

  return { current, estimated }
}
