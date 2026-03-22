/**
 * Heuristic correction detector for the Fault Memory feature.
 *
 * Scans user messages for correction patterns like:
 *   - "use X not Y" / "use X instead of Y"
 *   - "don't use Y, use X"
 *   - "we use X" / "this project uses X" / "always use X"
 *   - "no, it should be X" / "that's wrong, it's X"
 *   - "prefer X over Y"
 *
 * Returns null when no correction is confidently detected (conservative).
 */

import type { FactCategory } from './fault-memory-types'

export interface DetectedCorrection {
  pattern: string      // What was wrong or what to avoid
  correction: string   // What's right or preferred
  category: FactCategory
}

// ─── Category inference ───

const TOOLING_KEYWORDS = new Set([
  'npm', 'pnpm', 'yarn', 'bun', 'webpack', 'vite', 'esbuild', 'rollup',
  'jest', 'vitest', 'mocha', 'prettier', 'eslint', 'biome', 'docker',
  'podman', 'make', 'cmake', 'cargo', 'pip', 'poetry', 'conda',
  'nvm', 'fnm', 'node', 'deno', 'tsx', 'ts-node',
])

const STYLE_KEYWORDS = new Set([
  'tabs', 'spaces', 'semicolons', 'semicolon', 'quotes', 'single quotes',
  'double quotes', 'camelcase', 'snake_case', 'kebab-case', 'pascalcase',
  'indent', 'indentation', 'trailing comma', 'newline', 'braces',
  'arrow functions', 'function declarations',
])

function inferCategory(text: string): FactCategory {
  const lower = text.toLowerCase()
  const words = lower.split(/\s+/)

  for (const word of words) {
    if (TOOLING_KEYWORDS.has(word)) return 'tooling'
    if (STYLE_KEYWORDS.has(word)) return 'style'
  }

  // Multi-word style matches
  for (const kw of STYLE_KEYWORDS) {
    if (kw.includes(' ') && lower.includes(kw)) return 'style'
  }

  // Convention signals
  if (/\b(convention|naming|file names?|folder|directory structure)\b/i.test(lower)) {
    return 'convention'
  }

  // Preference signals
  if (/\b(prefer|like|want|please)\b/i.test(lower)) {
    return 'preference'
  }

  return 'other'
}

// ─── Pattern definitions ───

interface PatternRule {
  regex: RegExp
  /** Extract (pattern, correction) from match groups. Return null to skip. */
  extract: (match: RegExpMatchArray) => { pattern: string; correction: string } | null
}

/**
 * Extracts a clean token/phrase from a regex group capture.
 * Returns null if the capture is empty or too long (likely not a real correction).
 */
function clean(raw: string | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/[.,!?;]+$/, '').trim()
  if (!trimmed || trimmed.length > 80) return null
  return trimmed
}

const RULES: PatternRule[] = [
  // "use X instead of Y"
  {
    regex: /\buse\s+(.+?)\s+instead\s+of\s+(.+?)(?:\.|,|!|$)/i,
    extract: (m) => {
      const correction = clean(m[1])
      const pattern = clean(m[2])
      return correction && pattern ? { pattern, correction } : null
    },
  },
  // "use X not Y" / "use X, not Y"
  {
    regex: /\buse\s+(.+?),?\s+not\s+(.+?)(?:\.|,|!|$)/i,
    extract: (m) => {
      const correction = clean(m[1])
      const pattern = clean(m[2])
      return correction && pattern ? { pattern, correction } : null
    },
  },
  // "don't use Y, use X" / "do not use Y, use X"
  {
    regex: /\bdon'?t\s+use\s+(.+?),?\s+use\s+(.+?)(?:\.|,|!|$)/i,
    extract: (m) => {
      const pattern = clean(m[1])
      const correction = clean(m[2])
      return pattern && correction ? { pattern, correction } : null
    },
  },
  {
    regex: /\bdo\s+not\s+use\s+(.+?),?\s+use\s+(.+?)(?:\.|,|!|$)/i,
    extract: (m) => {
      const pattern = clean(m[1])
      const correction = clean(m[2])
      return pattern && correction ? { pattern, correction } : null
    },
  },
  // "prefer X over Y"
  {
    regex: /\bprefer\s+(.+?)\s+over\s+(.+?)(?:\.|,|!|$)/i,
    extract: (m) => {
      const correction = clean(m[1])
      const pattern = clean(m[2])
      return correction && pattern ? { pattern, correction } : null
    },
  },
  // "we use X" / "this project uses X" / "always use X"
  {
    regex: /\b(?:we|this project)\s+uses?\s+(.+?)(?:\.|,|!|$)/i,
    extract: (m) => {
      const correction = clean(m[1])
      return correction ? { pattern: '', correction } : null
    },
  },
  {
    regex: /\balways\s+use\s+(.+?)(?:\.|,|!|$)/i,
    extract: (m) => {
      const correction = clean(m[1])
      return correction ? { pattern: '', correction } : null
    },
  },
  // "no, it should be X" / "that's wrong, it's X"
  {
    regex: /\bno,?\s+(?:it\s+)?should\s+be\s+(.+?)(?:\.|,|!|$)/i,
    extract: (m) => {
      const correction = clean(m[1])
      return correction ? { pattern: '', correction } : null
    },
  },
  {
    regex: /\bthat'?s?\s+wrong,?\s+(?:it'?s?\s+)?(.+?)(?:\.|,|!|$)/i,
    extract: (m) => {
      const correction = clean(m[1])
      return correction ? { pattern: '', correction } : null
    },
  },
  // "never use X" / "stop using X"
  {
    regex: /\b(?:never|stop)\s+us(?:e|ing)\s+(.+?)(?:\.|,|!|$)/i,
    extract: (m) => {
      const pattern = clean(m[1])
      return pattern ? { pattern, correction: '' } : null
    },
  },
]

// ─── Public API ───

/**
 * Attempt to detect a user correction in a message.
 * Returns null when no correction is confidently detected.
 */
export function detectCorrection(userMessage: string): DetectedCorrection | null {
  if (!userMessage || userMessage.length < 8 || userMessage.length > 1000) {
    return null
  }

  // Normalise whitespace
  const normalised = userMessage.replace(/\s+/g, ' ').trim()

  for (const rule of RULES) {
    const match = normalised.match(rule.regex)
    if (match) {
      const result = rule.extract(match)
      if (result) {
        // Must have at least one of pattern/correction
        if (!result.pattern && !result.correction) continue
        return {
          pattern: result.pattern,
          correction: result.correction,
          category: inferCategory(normalised),
        }
      }
    }
  }

  return null
}
