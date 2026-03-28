import { describe, it, expect } from 'vitest'
import { trimTier } from '../../src/main/context/retrieval-service'

describe('trimTier – intra-tier truncation (CTX-004)', () => {
  it('keeps only top items by score that fit within the budget', () => {
    // 5 items, each ~100 tokens (400 chars / 4 = 100 tokens)
    const entries = [
      { content: 'a'.repeat(400), score: 0.5 },
      { content: 'b'.repeat(400), score: 0.9 },
      { content: 'c'.repeat(400), score: 0.7 },
      { content: 'd'.repeat(400), score: 0.3 },
      { content: 'e'.repeat(400), score: 0.8 },
    ]

    // Budget of 400 tokens allows at most 4 items, but let's use 300 to keep 3
    const result = trimTier(entries, 300)

    expect(result).toHaveLength(3)
    // Should be the top 3 by score: 0.9, 0.8, 0.7
    const scores = result.map((e) => e.score)
    expect(scores).toContain(0.9)
    expect(scores).toContain(0.8)
    expect(scores).toContain(0.7)
    expect(scores).not.toContain(0.5)
    expect(scores).not.toContain(0.3)
  })

  it('preserves multiple tiers (not all-or-nothing) by trimming each independently', () => {
    // Tier A: 2 items, 50 tokens each = 100 tokens total, budget 100 => both fit
    const tierA = [
      { content: 'x'.repeat(200), score: 0.6 },
      { content: 'y'.repeat(200), score: 0.4 },
    ]
    // Tier B: 3 items, 100 tokens each = 300 tokens total, budget 150 => only 1 fits
    const tierB = [
      { content: 'p'.repeat(400), score: 0.3 },
      { content: 'q'.repeat(400), score: 0.8 },
      { content: 'r'.repeat(400), score: 0.5 },
    ]

    const resultA = trimTier(tierA, 100)
    const resultB = trimTier(tierB, 150)

    // Tier A is fully preserved
    expect(resultA).toHaveLength(2)
    // Tier B is trimmed to the single highest-scoring item
    expect(resultB).toHaveLength(1)
    expect(resultB[0].score).toBe(0.8)
  })

  it('leaves a tier within budget untouched', () => {
    const entries = [
      { content: 'short'.repeat(10), score: 0.5 },
      { content: 'also short'.repeat(10), score: 0.7 },
    ]
    // Each is ~25 chars => ~7 tokens. Budget of 100 easily fits both.
    const result = trimTier(entries, 100)
    expect(result).toHaveLength(2)
  })

  it('returns empty array for empty tier', () => {
    const result = trimTier([], 400)
    expect(result).toEqual([])
  })
})
