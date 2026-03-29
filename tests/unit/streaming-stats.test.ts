// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  countWords,
  estimateCost,
  formatCost,
  formatTokens,
  formatElapsed,
} from '../../src/renderer/components/StreamingStatsBar'

describe('countWords', () => {
  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0)
  })

  it('returns 0 for whitespace-only string', () => {
    expect(countWords('   \n\t  ')).toBe(0)
  })

  it('counts single word', () => {
    expect(countWords('hello')).toBe(1)
  })

  it('counts multiple words', () => {
    expect(countWords('hello world foo bar')).toBe(4)
  })

  it('handles multiple spaces between words', () => {
    expect(countWords('hello   world')).toBe(2)
  })

  it('handles newlines and tabs', () => {
    expect(countWords('hello\nworld\tfoo')).toBe(3)
  })

  it('handles leading/trailing whitespace', () => {
    expect(countWords('  hello world  ')).toBe(2)
  })
})

describe('estimateCost', () => {
  it('returns 0 for 0 tokens', () => {
    expect(estimateCost(0, 'claude-opus-4-6')).toBe(0)
  })

  it('uses $15/MTok for opus model', () => {
    expect(estimateCost(1_000_000, 'claude-opus-4-6')).toBe(15)
  })

  it('uses $15/MTok for sonnet model', () => {
    expect(estimateCost(1_000_000, 'claude-sonnet-4-6')).toBe(15)
  })

  it('uses $5/MTok for haiku model', () => {
    expect(estimateCost(1_000_000, 'claude-haiku-4-5-20251001')).toBe(5)
  })

  it('defaults to $15/MTok for null model', () => {
    expect(estimateCost(1_000_000, null)).toBe(15)
  })

  it('calculates fractional costs correctly', () => {
    // 1000 tokens at $15/MTok = $0.015
    expect(estimateCost(1000, 'claude-opus-4-6')).toBeCloseTo(0.015, 5)
  })
})

describe('formatCost', () => {
  it('formats tiny costs with 4 decimals', () => {
    expect(formatCost(0.001)).toBe('$0.0010')
  })

  it('formats sub-dollar costs with 3 decimals', () => {
    expect(formatCost(0.15)).toBe('$0.150')
  })

  it('formats dollar+ costs with 2 decimals', () => {
    expect(formatCost(1.5)).toBe('$1.50')
  })
})

describe('formatTokens', () => {
  it('returns raw number under 1k', () => {
    expect(formatTokens(500)).toBe('500')
  })

  it('formats thousands with k suffix', () => {
    expect(formatTokens(1500)).toBe('1.5k')
  })

  it('formats millions with M suffix', () => {
    expect(formatTokens(1_500_000)).toBe('1.50M')
  })
})

describe('formatElapsed', () => {
  it('formats seconds under a minute', () => {
    expect(formatElapsed(5.3)).toBe('5.3s')
  })

  it('formats exact minutes', () => {
    expect(formatElapsed(120)).toBe('2m')
  })

  it('formats minutes and seconds', () => {
    expect(formatElapsed(90)).toBe('1m 30s')
  })

  it('formats zero', () => {
    expect(formatElapsed(0)).toBe('0.0s')
  })
})
