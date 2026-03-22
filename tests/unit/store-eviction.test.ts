import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEvictionManager,
  type EvictionConfig,
  type EvictableEntry,
} from '../../src/renderer/stores/store-eviction'

describe('createEvictionManager', () => {
  let now: number

  beforeEach(() => {
    now = 1_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ─── LRU eviction ───

  describe('LRU eviction (maxEntries)', () => {
    it('does not evict when entry count is within limit', () => {
      const mgr = createEvictionManager<string>({ maxEntries: 3 })
      mgr.touch('a')
      mgr.touch('b')
      mgr.touch('c')

      expect(mgr.shouldEvict('a')).toBe(false)
      expect(mgr.shouldEvict('b')).toBe(false)
      expect(mgr.shouldEvict('c')).toBe(false)
    })

    it('evicts the least-recently-used entry when maxEntries is exceeded', () => {
      const mgr = createEvictionManager<string>({ maxEntries: 3 })
      mgr.touch('a') // oldest
      mgr.touch('b')
      mgr.touch('c')
      mgr.touch('d') // exceeds limit

      const evicted = mgr.getEvictable(['a', 'b', 'c', 'd'])
      expect(evicted).toContain('a')
      expect(evicted).not.toContain('d')
    })

    it('respects access order — recently accessed entry survives', () => {
      const mgr = createEvictionManager<string>({ maxEntries: 3 })
      mgr.touch('a')
      mgr.touch('b')
      mgr.touch('c')

      // Re-access 'a' to make it recent
      vi.advanceTimersByTime(100)
      mgr.touch('a')

      mgr.touch('d') // exceeds limit

      const evicted = mgr.getEvictable(['a', 'b', 'c', 'd'])
      // 'b' is now oldest (a was re-touched)
      expect(evicted).toContain('b')
      expect(evicted).not.toContain('a')
    })

    it('returns empty array when no eviction is needed', () => {
      const mgr = createEvictionManager<string>({ maxEntries: 10 })
      mgr.touch('x')
      mgr.touch('y')

      const evicted = mgr.getEvictable(['x', 'y'])
      expect(evicted).toHaveLength(0)
    })

    it('evicts multiple entries when count exceeds limit by more than one', () => {
      const mgr = createEvictionManager<string>({ maxEntries: 2 })
      mgr.touch('a')
      mgr.touch('b')
      mgr.touch('c')
      mgr.touch('d')
      mgr.touch('e')

      const evicted = mgr.getEvictable(['a', 'b', 'c', 'd', 'e'])
      expect(evicted).toHaveLength(3)
      expect(evicted).toContain('a')
      expect(evicted).toContain('b')
      expect(evicted).toContain('c')
    })
  })

  // ─── TTL eviction ───

  describe('TTL eviction (maxAgeMs)', () => {
    it('does not evict entries within TTL', () => {
      const mgr = createEvictionManager<string>({ maxAgeMs: 5_000 })
      mgr.touch('a')

      vi.advanceTimersByTime(4_999)

      const evicted = mgr.getEvictable(['a'])
      expect(evicted).toHaveLength(0)
    })

    it('evicts entries that exceed TTL', () => {
      const mgr = createEvictionManager<string>({ maxAgeMs: 5_000 })
      mgr.touch('a')

      vi.advanceTimersByTime(5_001)

      const evicted = mgr.getEvictable(['a'])
      expect(evicted).toContain('a')
    })

    it('only evicts entries older than TTL, not fresh ones', () => {
      const mgr = createEvictionManager<string>({ maxAgeMs: 10_000 })
      mgr.touch('old')

      vi.advanceTimersByTime(8_000)
      mgr.touch('new')

      vi.advanceTimersByTime(3_000) // total 11s after 'old', 3s after 'new'

      const evicted = mgr.getEvictable(['old', 'new'])
      expect(evicted).toContain('old')
      expect(evicted).not.toContain('new')
    })

    it('touching an entry resets its TTL clock', () => {
      const mgr = createEvictionManager<string>({ maxAgeMs: 5_000 })
      mgr.touch('a')

      vi.advanceTimersByTime(4_000)
      mgr.touch('a') // resets TTL

      vi.advanceTimersByTime(4_000) // only 4s since last touch

      const evicted = mgr.getEvictable(['a'])
      expect(evicted).toHaveLength(0)
    })
  })

  // ─── Combined LRU + TTL ───

  describe('combined maxEntries + maxAgeMs', () => {
    it('evicts by age when TTL exceeded regardless of count', () => {
      const mgr = createEvictionManager<string>({ maxEntries: 100, maxAgeMs: 1_000 })
      mgr.touch('old')

      vi.advanceTimersByTime(2_000)
      mgr.touch('new')

      const evicted = mgr.getEvictable(['old', 'new'])
      expect(evicted).toContain('old')
      expect(evicted).not.toContain('new')
    })

    it('evicts by LRU when count exceeds limit', () => {
      const mgr = createEvictionManager<string>({ maxEntries: 2, maxAgeMs: 100_000 })
      mgr.touch('a')
      mgr.touch('b')
      mgr.touch('c')

      const evicted = mgr.getEvictable(['a', 'b', 'c'])
      expect(evicted).toContain('a')
    })
  })

  // ─── shouldEvict per-entry ───

  describe('shouldEvict', () => {
    it('returns false for unknown keys', () => {
      const mgr = createEvictionManager<string>({ maxEntries: 3 })
      // 'unknown' was never touched
      expect(mgr.shouldEvict('unknown')).toBe(false)
    })

    it('returns true for expired entry', () => {
      const mgr = createEvictionManager<string>({ maxAgeMs: 1_000 })
      mgr.touch('x')
      vi.advanceTimersByTime(2_000)
      expect(mgr.shouldEvict('x')).toBe(true)
    })

    it('returns false for fresh entry', () => {
      const mgr = createEvictionManager<string>({ maxAgeMs: 10_000 })
      mgr.touch('x')
      vi.advanceTimersByTime(1_000)
      expect(mgr.shouldEvict('x')).toBe(false)
    })
  })

  // ─── delete ───

  describe('delete', () => {
    it('removes entry from tracking', () => {
      const mgr = createEvictionManager<string>({ maxAgeMs: 1_000 })
      mgr.touch('x')
      mgr.delete('x')

      vi.advanceTimersByTime(2_000)
      // After delete + TTL, shouldEvict should return false (not tracked)
      expect(mgr.shouldEvict('x')).toBe(false)
    })
  })

  // ─── cleanup ───

  describe('cleanup()', () => {
    it('forces immediate eviction and calls the callback', () => {
      const removed: string[] = []
      const mgr = createEvictionManager<string>({ maxAgeMs: 5_000 }, (key) => removed.push(key))

      mgr.touch('a')
      mgr.touch('b')

      vi.advanceTimersByTime(6_000)

      mgr.cleanup(['a', 'b'])

      expect(removed).toContain('a')
      expect(removed).toContain('b')
    })

    it('does not remove fresh entries on cleanup', () => {
      const removed: string[] = []
      const mgr = createEvictionManager<string>({ maxAgeMs: 10_000 }, (key) => removed.push(key))

      mgr.touch('fresh')
      vi.advanceTimersByTime(1_000)
      mgr.cleanup(['fresh'])

      expect(removed).toHaveLength(0)
    })
  })

  // ─── periodic eviction ───

  describe('periodic eviction via startInterval', () => {
    it('fires eviction callback on schedule', () => {
      const removed: string[] = []
      const mgr = createEvictionManager<string>(
        { maxAgeMs: 1_000, evictionInterval: 5_000 },
        (key) => removed.push(key),
      )

      mgr.touch('expiring')
      vi.advanceTimersByTime(2_000) // TTL exceeded

      // Now start the interval and provide the current keys
      const stop = mgr.startInterval(() => ['expiring'])
      vi.advanceTimersByTime(5_001)

      expect(removed).toContain('expiring')
      stop()
    })

    it('stops firing after stop() is called', () => {
      const removed: string[] = []
      const mgr = createEvictionManager<string>(
        { maxAgeMs: 1_000, evictionInterval: 5_000 },
        (key) => removed.push(key),
      )

      mgr.touch('x')
      vi.advanceTimersByTime(2_000)

      const stop = mgr.startInterval(() => ['x'])
      vi.advanceTimersByTime(5_001)
      expect(removed).toContain('x')

      removed.length = 0
      stop()

      mgr.touch('y')
      vi.advanceTimersByTime(2_000)
      vi.advanceTimersByTime(5_001)
      expect(removed).toHaveLength(0)
    })
  })

  // ─── getAll / size ───

  describe('getAll and size', () => {
    it('getAll returns all tracked entries', () => {
      const mgr = createEvictionManager<string>({ maxEntries: 10 })
      mgr.touch('a')
      mgr.touch('b')
      mgr.touch('c')

      const all = mgr.getAll()
      expect(all).toHaveLength(3)
      expect(all.map((e) => e.key)).toEqual(expect.arrayContaining(['a', 'b', 'c']))
    })

    it('size returns the count of tracked entries', () => {
      const mgr = createEvictionManager<string>({ maxEntries: 10 })
      mgr.touch('a')
      mgr.touch('b')
      expect(mgr.size()).toBe(2)
      mgr.delete('a')
      expect(mgr.size()).toBe(1)
    })
  })
})
