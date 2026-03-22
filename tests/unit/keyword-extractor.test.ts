import { describe, it, expect } from 'vitest'
import { extractKeywords, keywordOverlapScore } from '../../src/shared/keyword-extractor'

describe('keyword-extractor', () => {
  describe('extractKeywords', () => {
    it('returns empty array for empty input', () => {
      expect(extractKeywords('')).toEqual([])
      expect(extractKeywords('  ')).toEqual([])
    })

    it('removes stop words', () => {
      const keywords = extractKeywords('the quick brown fox is very fast and also nice')
      expect(keywords).not.toContain('the')
      expect(keywords).not.toContain('is')
      expect(keywords).not.toContain('and')
      expect(keywords).not.toContain('very')
      expect(keywords).toContain('quick')
      expect(keywords).toContain('brown')
      expect(keywords).toContain('fox')
    })

    it('removes short words (< 3 chars)', () => {
      const keywords = extractKeywords('go to the big ax by me')
      expect(keywords).not.toContain('go')
      expect(keywords).not.toContain('to')
      expect(keywords).not.toContain('ax')
      expect(keywords).not.toContain('by')
      expect(keywords).not.toContain('me')
      expect(keywords).toContain('big')
    })

    it('removes pure numbers', () => {
      const keywords = extractKeywords('error 404 in authentication module 2')
      expect(keywords).not.toContain('404')
      expect(keywords).not.toContain('2')
      expect(keywords).toContain('error')
      expect(keywords).toContain('authentication')
    })

    it('sorts by frequency', () => {
      const keywords = extractKeywords('auth auth auth bug bug fix')
      expect(keywords[0]).toBe('auth')
      expect(keywords[1]).toBe('bug')
      expect(keywords[2]).toBe('fix')
    })

    it('limits to 20 keywords', () => {
      const text = Array.from({ length: 30 }, (_, i) => `keyword${i}`).join(' ')
      const keywords = extractKeywords(text)
      expect(keywords.length).toBeLessThanOrEqual(20)
    })

    it('handles technical terms', () => {
      const keywords = extractKeywords('fix authentication middleware in src/auth/handler.ts')
      expect(keywords).toContain('fix')
      expect(keywords).toContain('authentication')
      expect(keywords).toContain('middleware')
    })
  })

  describe('keywordOverlapScore', () => {
    it('returns 0 for empty arrays', () => {
      expect(keywordOverlapScore([], ['auth'])).toBe(0)
      expect(keywordOverlapScore(['auth'], [])).toBe(0)
    })

    it('returns 1 for perfect match', () => {
      expect(keywordOverlapScore(['auth', 'fix'], ['auth', 'fix'])).toBe(1)
    })

    it('returns 0 for no overlap', () => {
      expect(keywordOverlapScore(['auth'], ['database'])).toBe(0)
    })

    it('returns partial score for partial overlap', () => {
      const score = keywordOverlapScore(['auth', 'fix', 'bug'], ['auth', 'middleware', 'handler'])
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThan(1)
    })
  })
})
