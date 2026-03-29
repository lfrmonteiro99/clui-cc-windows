/**
 * ENRICH-004: Clickable References
 *
 * Detects URLs, file paths, GitHub issue/PR refs, and hex colors in text.
 */

export type ReferenceType = 'url' | 'file' | 'github' | 'color'

export interface Reference {
  type: ReferenceType
  value: string
  start: number
  end: number
}

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g
const FILE_PATH_RE = /(?:[A-Z]:[/\\]|\/)[^\s"'`,;:*?<>|()[\]{}]+\.\w+/gi
const GITHUB_REF_RE = /(?<![&\w])#(\d{1,6})\b/g
// Hex colors must contain at least one letter (a-f) to distinguish from GitHub refs like #123
const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g
const HEX_HAS_ALPHA = /[a-fA-F]/

/**
 * Detect all references in the given text.
 * Returns them sorted by start position.
 */
export function detectReferences(text: string): Reference[] {
  const refs: Reference[] = []

  // URLs
  for (const match of text.matchAll(URL_RE)) {
    refs.push({
      type: 'url',
      value: match[0],
      start: match.index!,
      end: match.index! + match[0].length,
    })
  }

  // File paths (skip if inside a URL we already found)
  for (const match of text.matchAll(FILE_PATH_RE)) {
    const start = match.index!
    const end = start + match[0].length
    const overlaps = refs.some((r) => start >= r.start && start < r.end)
    if (!overlaps) {
      refs.push({ type: 'file', value: match[0], start, end })
    }
  }

  // Hex colors — must check BEFORE GitHub refs since both start with #
  // Only treat as color if the hex digits contain at least one a-f letter
  for (const match of text.matchAll(HEX_COLOR_RE)) {
    const hexPart = match[0].slice(1) // strip #
    if (!HEX_HAS_ALPHA.test(hexPart)) continue // pure digits → likely GitHub ref
    const start = match.index!
    const end = start + match[0].length
    const overlaps = refs.some((r) => start >= r.start && start < r.end)
    if (!overlaps) {
      refs.push({ type: 'color', value: match[0], start, end })
    }
  }

  // GitHub refs (#123) — skip hex colors
  for (const match of text.matchAll(GITHUB_REF_RE)) {
    const start = match.index!
    const end = start + match[0].length
    const overlaps = refs.some((r) => start >= r.start && start < r.end)
    if (!overlaps) {
      refs.push({ type: 'github', value: match[0], start, end })
    }
  }

  return refs.sort((a, b) => a.start - b.start)
}
