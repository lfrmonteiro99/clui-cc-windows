// ─── Reference Detection in Text ───
// Pure functions to detect clickable references: URLs, file paths, GitHub refs, hex colors.

export interface Reference {
  type: 'url' | 'filepath' | 'github-ref' | 'color'
  text: string
  start: number
  end: number
  /** Resolved value — full URL for urls/github-refs, path for filepaths, hex for colors */
  value: string
}

// ─── Patterns ───

// URL: http or https, greedy but stops at whitespace, angle brackets, closing parens
const URL_RE = /https?:\/\/[^\s<>)]+/g

// GitHub ref: optional owner/repo prefix + #digits
const GITHUB_REF_RE = /(?:[\w-]+\/[\w.-]+)?#(\d+)/g

// Hex color: # followed by hex digits, word-bounded
const HEX_COLOR_RE = /#([0-9a-fA-F]{3,8})\b/g

// File path: contains / or \, has a file extension or known extensionless name
const KNOWN_EXTENSIONLESS = new Set([
  'Makefile', 'Dockerfile', 'Vagrantfile', 'Gemfile',
  'Rakefile', 'Procfile', 'Brewfile',
])

function isFilePath(text: string): boolean {
  if (!text.includes('/') && !text.includes('\\')) return false
  if (/^https?:\/\//i.test(text)) return false
  if (text.includes('://')) return false
  const basename = text.split(/[/\\]/).pop() || ''
  if (KNOWN_EXTENSIONLESS.has(basename)) return true
  if (!/\.\w{1,6}$/.test(text)) return false
  if (/^v?\d+\.\d+/.test(text)) return false
  if (/^\d+\.\d+$/.test(text)) return false
  return true
}

// File path pattern: word chars, dots, hyphens separated by / or \, with extension
// Must start with ./ ../ / ~ or a letter, contain a slash, and end with .ext
const FILE_PATH_RE = /(?:[.~]?[/\\]|[a-zA-Z]:\\)[\w./-\\]+/g

function isHexColor(hex: string): boolean {
  const len = hex.length
  // Valid hex color lengths: 3, 4, 6, 8
  return len === 3 || len === 4 || len === 6 || len === 8
}

function isGitHubRefNotColor(digits: string): boolean {
  // If the digits portion is 1-4 digits, treat as GitHub ref, not color
  // Even if it happens to be valid hex, #123 is much more likely a ref than a color
  return digits.length <= 4
}

// ─── Main Detection Function ───

export function detectReferences(text: string): Reference[] {
  if (!text) return []

  const refs: Reference[] = []
  // Track occupied ranges to avoid overlaps
  const occupied: Array<[number, number]> = []

  function isOccupied(start: number, end: number): boolean {
    return occupied.some(([s, e]) => start < e && end > s)
  }

  function addRef(ref: Reference): void {
    if (!isOccupied(ref.start, ref.end)) {
      refs.push(ref)
      occupied.push([ref.start, ref.end])
    }
  }

  // 1. URLs first (highest priority)
  URL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = URL_RE.exec(text)) !== null) {
    // Skip URLs inside markdown link syntax: [text](url)
    // Check if preceded by ](
    const before = text.slice(Math.max(0, m.index - 2), m.index)
    if (before.endsWith('](')) continue

    // Strip trailing punctuation that's likely not part of the URL
    let url = m[0]
    // Remove trailing periods, commas, semicolons, colons (unless part of port like :8080)
    url = url.replace(/[.,;:]+$/, '')
    addRef({
      type: 'url',
      text: url,
      start: m.index,
      end: m.index + url.length,
      value: url,
    })
  }

  // 2. GitHub refs (before colors, since #123 could be either)
  GITHUB_REF_RE.lastIndex = 0
  while ((m = GITHUB_REF_RE.exec(text)) !== null) {
    if (isOccupied(m.index, m.index + m[0].length)) continue

    const fullMatch = m[0]
    const digits = m[1]

    // Check it's not preceded by a word char (avoid matching inside words)
    if (m.index > 0 && /\w/.test(text[m.index - 1])) continue

    // Determine if this is a GitHub ref or potentially a color
    const hasPrefix = fullMatch.includes('/')
    if (hasPrefix || isGitHubRefNotColor(digits)) {
      // Definitely a GitHub ref
      const repoPrefix = hasPrefix ? fullMatch.split('#')[0] : ''
      const issueNum = digits
      const githubUrl = hasPrefix
        ? `https://github.com/${repoPrefix}/issues/${issueNum}`
        : `#${issueNum}` // relative — caller can resolve
      addRef({
        type: 'github-ref',
        text: fullMatch,
        start: m.index,
        end: m.index + fullMatch.length,
        value: githubUrl,
      })
    }
  }

  // 3. Hex colors
  HEX_COLOR_RE.lastIndex = 0
  while ((m = HEX_COLOR_RE.exec(text)) !== null) {
    if (isOccupied(m.index, m.index + m[0].length)) continue

    const hex = m[1]
    if (!isHexColor(hex)) continue

    // Disambiguate: if pure digits and <= 4 chars, it was already claimed as GitHub ref
    // Additional check: if all chars are 0-9 (no a-f), it's more likely a ref
    if (/^\d+$/.test(hex) && hex.length <= 4) continue

    // Must not be preceded by a word char (avoid matching inside identifiers)
    if (m.index > 0 && /\w/.test(text[m.index - 1])) continue

    addRef({
      type: 'color',
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
      value: m[0],
    })
  }

  // 4. File paths
  FILE_PATH_RE.lastIndex = 0
  while ((m = FILE_PATH_RE.exec(text)) !== null) {
    if (isOccupied(m.index, m.index + m[0].length)) continue
    const candidate = m[0]
    if (!isFilePath(candidate)) continue

    addRef({
      type: 'filepath',
      text: candidate,
      start: m.index,
      end: m.index + candidate.length,
      value: candidate,
    })
  }

  // Sort by start position
  refs.sort((a, b) => a.start - b.start)
  return refs
}
