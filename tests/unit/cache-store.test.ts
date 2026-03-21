import { describe, it, expect, beforeEach } from 'vitest'
import { useCacheStore } from '../../src/renderer/stores/cacheStore'

describe('cacheStore', () => {
  beforeEach(() => {
    useCacheStore.setState({
      enabled: true,
      ttlMs: 3_600_000,
      maxEntries: 200,
      stats: { hits: 0, misses: 0, savedUsd: 0 },
    })
  })

  it('starts enabled with default TTL', () => {
    const state = useCacheStore.getState()
    expect(state.enabled).toBe(true)
    expect(state.ttlMs).toBe(3_600_000)
    expect(state.maxEntries).toBe(200)
  })

  it('toggles enabled', () => {
    useCacheStore.getState().setEnabled(false)
    expect(useCacheStore.getState().enabled).toBe(false)
  })

  it('updates TTL', () => {
    useCacheStore.getState().setTtl(1_800_000)
    expect(useCacheStore.getState().ttlMs).toBe(1_800_000)
  })

  it('records a hit', () => {
    useCacheStore.getState().recordHit(0.05)
    const { stats } = useCacheStore.getState()
    expect(stats.hits).toBe(1)
    expect(stats.savedUsd).toBeCloseTo(0.05)
  })

  it('records a miss', () => {
    useCacheStore.getState().recordMiss()
    expect(useCacheStore.getState().stats.misses).toBe(1)
  })

  it('accumulates stats', () => {
    useCacheStore.getState().recordHit(0.05)
    useCacheStore.getState().recordHit(0.03)
    useCacheStore.getState().recordMiss()
    const { stats } = useCacheStore.getState()
    expect(stats.hits).toBe(2)
    expect(stats.misses).toBe(1)
    expect(stats.savedUsd).toBeCloseTo(0.08)
  })

  it('computes hit rate', () => {
    useCacheStore.getState().recordHit(0.05)
    useCacheStore.getState().recordMiss()
    expect(useCacheStore.getState().getHitRate()).toBeCloseTo(0.5)
  })

  it('returns 0 hit rate with no lookups', () => {
    expect(useCacheStore.getState().getHitRate()).toBe(0)
  })

  it('resets stats', () => {
    useCacheStore.getState().recordHit(0.05)
    useCacheStore.getState().recordMiss()
    useCacheStore.getState().resetStats()
    const { stats } = useCacheStore.getState()
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(0)
    expect(stats.savedUsd).toBe(0)
  })
})
