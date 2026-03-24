import { describe, it, expect, beforeEach } from 'vitest'
import { TokenTracker } from '../../token-tracker'

describe('TokenTracker', () => {
  let tracker: TokenTracker

  beforeEach(() => {
    tracker = new TokenTracker()
  })

  it('starts with no usage for unknown tab', () => {
    expect(tracker.getTokenUsage('tab-1')).toBeNull()
  })

  it('accumulates input/output tokens from token_usage events', () => {
    tracker.recordUsage('tab-1', {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    })

    tracker.recordUsage('tab-1', {
      inputTokens: 2000,
      outputTokens: 800,
      totalTokens: 2800,
    })

    const usage = tracker.getTokenUsage('tab-1')
    expect(usage).not.toBeNull()
    expect(usage!.inputTokens).toBe(3000)
    expect(usage!.outputTokens).toBe(1300)
    expect(usage!.totalTokens).toBe(4300)
  })

  it('accumulates cache tokens', () => {
    tracker.recordUsage('tab-1', {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      cacheReadTokens: 3000,
      cacheWriteTokens: 200,
    })

    const usage = tracker.getTokenUsage('tab-1')
    expect(usage!.cacheReadTokens).toBe(3000)
    expect(usage!.cacheWriteTokens).toBe(200)
  })

  it('tracks per-tab token counts independently', () => {
    tracker.recordUsage('tab-1', {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    })

    tracker.recordUsage('tab-2', {
      inputTokens: 5000,
      outputTokens: 2000,
      totalTokens: 7000,
    })

    expect(tracker.getTokenUsage('tab-1')!.totalTokens).toBe(1500)
    expect(tracker.getTokenUsage('tab-2')!.totalTokens).toBe(7000)
  })

  it('resets on new session', () => {
    tracker.recordUsage('tab-1', {
      inputTokens: 5000,
      outputTokens: 2000,
      totalTokens: 7000,
    })

    tracker.resetTab('tab-1')
    expect(tracker.getTokenUsage('tab-1')).toBeNull()
  })

  it('estimates tokens from text using 4 chars per token heuristic', () => {
    const estimated = TokenTracker.estimateTokens('Hello, this is a test string with some content.')
    // 48 chars / 4 = 12 tokens
    expect(estimated).toBe(12)
  })

  it('estimates zero tokens for empty string', () => {
    expect(TokenTracker.estimateTokens('')).toBe(0)
  })

  it('updates lastUpdated timestamp on each record', () => {
    const before = Date.now()
    tracker.recordUsage('tab-1', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    })
    const after = Date.now()

    const usage = tracker.getTokenUsage('tab-1')
    expect(usage!.lastUpdated).toBeGreaterThanOrEqual(before)
    expect(usage!.lastUpdated).toBeLessThanOrEqual(after)
  })
})
