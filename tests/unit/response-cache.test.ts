import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ResponseCache, normalizePrompt } from '../../src/main/response-cache'

describe('normalizePrompt', () => {
  it('lowercases text', () => {
    expect(normalizePrompt('Hello World')).toBe('hello world')
  })

  it('collapses whitespace', () => {
    expect(normalizePrompt('hello   world')).toBe('hello world')
  })

  it('trims whitespace', () => {
    expect(normalizePrompt('  hello  ')).toBe('hello')
  })

  it('removes trailing punctuation', () => {
    expect(normalizePrompt('hello world.')).toBe('hello world')
    expect(normalizePrompt('hello world?')).toBe('hello world')
    expect(normalizePrompt('hello world!')).toBe('hello world')
  })

  it('strips common filler prefixes', () => {
    expect(normalizePrompt('please explain closures')).toBe('explain closures')
    expect(normalizePrompt('can you explain closures')).toBe('explain closures')
    expect(normalizePrompt('could you explain closures')).toBe('explain closures')
  })

  it('handles empty string', () => {
    expect(normalizePrompt('')).toBe('')
  })
})

describe('ResponseCache', () => {
  let cache: ResponseCache

  beforeEach(() => {
    cache = new ResponseCache({ maxEntries: 10, ttlMs: 60_000 })
  })

  // ─── Basic store/lookup ───

  it('stores and retrieves a cached response', () => {
    cache.store({
      prompt: 'what is a closure?',
      response: 'A closure is...',
      model: 'claude-haiku-4-5-20251001',
      projectPath: '/project',
      costUsd: 0.001,
    })

    const hit = cache.lookup('what is a closure?', '/project', 'claude-haiku-4-5-20251001')
    expect(hit).not.toBeNull()
    expect(hit!.response).toBe('A closure is...')
  })

  it('returns null for cache miss', () => {
    const hit = cache.lookup('unknown prompt', '/project', 'claude-haiku-4-5-20251001')
    expect(hit).toBeNull()
  })

  it('matches normalized prompts', () => {
    cache.store({
      prompt: 'What is a closure?',
      response: 'A closure is...',
      model: 'claude-haiku-4-5-20251001',
      projectPath: '/project',
      costUsd: 0.001,
    })

    // Different casing, extra whitespace, filler prefix
    const hit = cache.lookup('please  what is a closure', '/project', 'claude-haiku-4-5-20251001')
    expect(hit).not.toBeNull()
  })

  // ─── Key components ───

  it('separates by model', () => {
    cache.store({
      prompt: 'what is a closure?',
      response: 'Haiku answer',
      model: 'claude-haiku-4-5-20251001',
      projectPath: '/project',
      costUsd: 0.001,
    })

    const hit = cache.lookup('what is a closure?', '/project', 'claude-sonnet-4-6')
    expect(hit).toBeNull()
  })

  it('separates by projectPath', () => {
    cache.store({
      prompt: 'what is a closure?',
      response: 'Answer for project A',
      model: 'claude-haiku-4-5-20251001',
      projectPath: '/project-a',
      costUsd: 0.001,
    })

    const hit = cache.lookup('what is a closure?', '/project-b', 'claude-haiku-4-5-20251001')
    expect(hit).toBeNull()
  })

  // ─── TTL ───

  it('expires entries after TTL', () => {
    cache.store({
      prompt: 'hello',
      response: 'world',
      model: 'claude-haiku-4-5-20251001',
      projectPath: '/p',
      costUsd: 0.001,
    })

    // Manually expire
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000)
    const hit = cache.lookup('hello', '/p', 'claude-haiku-4-5-20251001')
    expect(hit).toBeNull()
    vi.restoreAllMocks()
  })

  // ─── LRU eviction ───

  it('evicts oldest entries when max is reached', () => {
    for (let i = 0; i < 12; i++) {
      cache.store({
        prompt: `prompt ${i}`,
        response: `response ${i}`,
        model: 'claude-haiku-4-5-20251001',
        projectPath: '/p',
        costUsd: 0.001,
      })
    }

    // First 2 should be evicted (max 10)
    expect(cache.lookup('prompt 0', '/p', 'claude-haiku-4-5-20251001')).toBeNull()
    expect(cache.lookup('prompt 1', '/p', 'claude-haiku-4-5-20251001')).toBeNull()
    // Later ones should exist
    expect(cache.lookup('prompt 11', '/p', 'claude-haiku-4-5-20251001')).not.toBeNull()
  })

  // ─── Hit count ───

  it('increments hit count on lookup', () => {
    cache.store({
      prompt: 'hello',
      response: 'world',
      model: 'claude-haiku-4-5-20251001',
      projectPath: '/p',
      costUsd: 0.001,
    })

    cache.lookup('hello', '/p', 'claude-haiku-4-5-20251001')
    cache.lookup('hello', '/p', 'claude-haiku-4-5-20251001')
    const hit = cache.lookup('hello', '/p', 'claude-haiku-4-5-20251001')
    expect(hit!.hitCount).toBe(3)
  })

  // ─── Stats ───

  it('tracks hit/miss/savings stats', () => {
    cache.store({
      prompt: 'hello',
      response: 'world',
      model: 'claude-haiku-4-5-20251001',
      projectPath: '/p',
      costUsd: 0.05,
    })

    cache.lookup('hello', '/p', 'claude-haiku-4-5-20251001') // hit
    cache.lookup('missing', '/p', 'claude-haiku-4-5-20251001') // miss

    const stats = cache.getStats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
    expect(stats.savedUsd).toBeCloseTo(0.05)
    expect(stats.entries).toBe(1)
  })

  // ─── Clear ───

  it('clears all entries', () => {
    cache.store({
      prompt: 'hello',
      response: 'world',
      model: 'claude-haiku-4-5-20251001',
      projectPath: '/p',
      costUsd: 0.001,
    })

    cache.clear()
    expect(cache.lookup('hello', '/p', 'claude-haiku-4-5-20251001')).toBeNull()
    expect(cache.getStats().entries).toBe(0)
  })

  // ─── Overwrite ───

  it('overwrites existing entry for same key', () => {
    cache.store({
      prompt: 'hello',
      response: 'first',
      model: 'claude-haiku-4-5-20251001',
      projectPath: '/p',
      costUsd: 0.001,
    })
    cache.store({
      prompt: 'hello',
      response: 'second',
      model: 'claude-haiku-4-5-20251001',
      projectPath: '/p',
      costUsd: 0.002,
    })

    const hit = cache.lookup('hello', '/p', 'claude-haiku-4-5-20251001')
    expect(hit!.response).toBe('second')
  })
})
