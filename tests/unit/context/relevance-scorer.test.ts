import { describe, it, expect } from 'vitest'
import {
  scoreItem,
  decayScore,
  extractKeyTokens,
  computePromptMatch,
  computeFileOverlap,
  ContextTier,
} from '../../../src/main/context/relevance-scorer'

describe('relevance-scorer', () => {
  describe('decayScore', () => {
    it('returns 1.0 for items from right now', () => {
      const now = new Date().toISOString()
      expect(decayScore(now, 48, 0.05)).toBeCloseTo(1.0, 1)
    })

    it('returns ~0.5 after one half-life', () => {
      const halfLife = 48
      const date = new Date(Date.now() - halfLife * 3_600_000).toISOString()
      expect(decayScore(date, halfLife, 0.05)).toBeCloseTo(0.5, 1)
    })

    it('returns ~0.25 after two half-lives', () => {
      const halfLife = 48
      const date = new Date(Date.now() - halfLife * 2 * 3_600_000).toISOString()
      expect(decayScore(date, halfLife, 0.05)).toBeCloseTo(0.25, 1)
    })

    it('never drops below the floor', () => {
      const veryOld = new Date(Date.now() - 365 * 24 * 3_600_000).toISOString()
      expect(decayScore(veryOld, 48, 0.05)).toBe(0.05)
    })

    it('respects custom floor', () => {
      const veryOld = new Date(Date.now() - 365 * 24 * 3_600_000).toISOString()
      expect(decayScore(veryOld, 48, 0.1)).toBe(0.1)
    })
  })

  describe('extractKeyTokens', () => {
    it('extracts meaningful tokens from text', () => {
      const tokens = extractKeyTokens('Fix the authentication middleware bug')
      expect(tokens.has('fix')).toBe(true)
      expect(tokens.has('authentication')).toBe(true)
      expect(tokens.has('middleware')).toBe(true)
      expect(tokens.has('bug')).toBe(true)
    })

    it('filters out stopwords', () => {
      const tokens = extractKeyTokens('the is a an of in for on with at by from')
      expect(tokens.size).toBe(0)
    })

    it('filters out short tokens (<=2 chars)', () => {
      const tokens = extractKeyTokens('go to do it')
      expect(tokens.size).toBe(0)
    })

    it('lowercases all tokens', () => {
      const tokens = extractKeyTokens('JWT Authentication Module')
      expect(tokens.has('jwt')).toBe(true)
      expect(tokens.has('authentication')).toBe(true)
      expect(tokens.has('module')).toBe(true)
    })

    it('handles file paths in text', () => {
      const tokens = extractKeyTokens('Look at src/auth/jwt.ts')
      expect(tokens.has('src/auth/jwt.ts')).toBe(true)
    })

    it('returns empty set for empty string', () => {
      expect(extractKeyTokens('').size).toBe(0)
    })
  })

  describe('computePromptMatch', () => {
    it('returns 0 for empty prompt tokens', () => {
      expect(computePromptMatch('some item text', '')).toBe(0)
    })

    it('returns high score for exact match', () => {
      const score = computePromptMatch(
        'Fix authentication middleware',
        'Fix authentication middleware',
      )
      expect(score).toBeGreaterThan(0.5)
    })

    it('returns moderate score for partial match', () => {
      const score = computePromptMatch(
        'JWT authentication refresh token rotation',
        'Fix authentication bug',
      )
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThan(1)
    })

    it('returns 0 for no match', () => {
      const score = computePromptMatch(
        'database migration schema',
        'frontend CSS styling',
      )
      expect(score).toBe(0)
    })
  })

  describe('computeFileOverlap', () => {
    it('returns 0 when memory has no files', () => {
      expect(computeFileOverlap([], ['src/a.ts'], ['src/b.ts'])).toBe(0)
    })

    it('returns 0 when no hot files', () => {
      expect(computeFileOverlap(['src/a.ts'], [], [])).toBe(0)
    })

    it('returns 1 when all memory files are hot', () => {
      const score = computeFileOverlap(
        ['src/a.ts', 'src/b.ts'],
        ['src/a.ts'],
        ['src/b.ts'],
      )
      expect(score).toBe(1.0)
    })

    it('returns 0.5 when half of memory files are hot', () => {
      const score = computeFileOverlap(
        ['src/a.ts', 'src/c.ts'],
        ['src/a.ts'],
        [],
      )
      expect(score).toBe(0.5)
    })
  })

  describe('scoreItem', () => {
    it('computes weighted composite score', () => {
      const score = scoreItem(
        {
          updatedAt: new Date().toISOString(),
          importanceScore: 0.8,
          searchableText: 'Fix authentication middleware bug',
          associatedFiles: ['src/auth/middleware.ts'],
          accessCount: 5,
        },
        'Fix auth middleware',
        {
          gitDiffFiles: ['src/auth/middleware.ts'],
          recentlyOpenedFiles: [],
        },
      )
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThanOrEqual(1)
    })

    it('gives higher score to recent items', () => {
      const recentScore = scoreItem(
        {
          updatedAt: new Date().toISOString(),
          importanceScore: 0.5,
          searchableText: 'auth fix',
          associatedFiles: [],
          accessCount: 0,
        },
        'auth fix',
        { gitDiffFiles: [], recentlyOpenedFiles: [] },
      )

      const oldScore = scoreItem(
        {
          updatedAt: new Date(Date.now() - 30 * 24 * 3_600_000).toISOString(),
          importanceScore: 0.5,
          searchableText: 'auth fix',
          associatedFiles: [],
          accessCount: 0,
        },
        'auth fix',
        { gitDiffFiles: [], recentlyOpenedFiles: [] },
      )

      expect(recentScore).toBeGreaterThan(oldScore)
    })

    it('gives higher score to more important items', () => {
      const base = {
        updatedAt: new Date().toISOString(),
        searchableText: 'auth fix',
        associatedFiles: [],
        accessCount: 0,
      }
      const state = { gitDiffFiles: [], recentlyOpenedFiles: [] }

      const highImportance = scoreItem({ ...base, importanceScore: 0.9 }, 'auth fix', state)
      const lowImportance = scoreItem({ ...base, importanceScore: 0.2 }, 'auth fix', state)

      expect(highImportance).toBeGreaterThan(lowImportance)
    })
  })
})
