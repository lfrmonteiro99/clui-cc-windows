/**
 * Store eviction utility — LRU + TTL pruning for Zustand stores.
 *
 * Usage:
 *   const mgr = createEvictionManager<string>(
 *     { maxEntries: 100, maxAgeMs: 7 * 24 * 60 * 60_000, evictionInterval: 60_000 },
 *     (key) => store.setState(s => { delete items[key]; return { items: { ...s.items } } }),
 *   )
 *
 *   // Call mgr.touch(id) whenever an entry is added or accessed.
 *   // Call mgr.delete(id) whenever an entry is explicitly removed.
 *   // Call mgr.startInterval(() => Object.keys(store.getState().items)) to start auto-pruning.
 */

// ─── Public types ───

export interface EvictionConfig {
  /** Maximum number of entries to keep (LRU). Unlimited if omitted. */
  maxEntries?: number
  /** Time-to-live in milliseconds. Never expires if omitted. */
  maxAgeMs?: number
  /** How often the periodic check runs (ms). Defaults to 60 000. */
  evictionInterval?: number
}

export interface EvictableEntry<K> {
  key: K
  /** Timestamp (ms) of the most recent touch(). */
  lastAccessedAt: number
}

export interface EvictionManager<K> {
  /**
   * Record an access (add or touch) for the given key.
   * This resets the TTL clock and updates LRU rank.
   */
  touch(key: K): void

  /**
   * Remove the key from the eviction tracker (e.g. after an explicit delete).
   */
  delete(key: K): void

  /**
   * Returns true if the entry for `key` has exceeded its TTL.
   * Returns false when `key` is unknown or no maxAgeMs is configured.
   */
  shouldEvict(key: K): boolean

  /**
   * Given the current set of live keys, returns those that should be removed
   * based on TTL and/or LRU cap.
   */
  getEvictable(liveKeys: K[]): K[]

  /**
   * Force-runs eviction over `liveKeys` and calls the onEvict callback for each
   * entry that should be pruned.
   */
  cleanup(liveKeys: K[]): void

  /**
   * Starts the periodic eviction interval.
   * @param getKeys - called each tick to obtain the current live key set.
   * @returns a stop() function that clears the interval.
   */
  startInterval(getKeys: () => K[]): () => void

  /** Returns a snapshot of all tracked entries (sorted oldest → newest). */
  getAll(): EvictableEntry<K>[]

  /** Returns the number of tracked entries. */
  size(): number
}

// ─── Implementation ───

/**
 * Create an EvictionManager for keys of type K.
 *
 * @param config    - eviction parameters
 * @param onEvict   - optional callback invoked for each evicted key; you are
 *                    responsible for removing the entry from your store inside it.
 */
export function createEvictionManager<K>(
  config: EvictionConfig,
  onEvict?: (key: K) => void,
): EvictionManager<K> {
  const { maxEntries, maxAgeMs, evictionInterval = 60_000 } = config

  // Internal tracking map: key → lastAccessedAt
  const tracker = new Map<K, number>()

  const touch = (key: K): void => {
    tracker.set(key, Date.now())
  }

  const del = (key: K): void => {
    tracker.delete(key)
  }

  const shouldEvict = (key: K): boolean => {
    if (!maxAgeMs) return false
    const ts = tracker.get(key)
    if (ts === undefined) return false
    return Date.now() - ts > maxAgeMs
  }

  const getEvictable = (liveKeys: K[]): K[] => {
    const toEvict = new Set<K>()

    // 1. TTL pass — mark any entry older than maxAgeMs
    if (maxAgeMs !== undefined) {
      const now = Date.now()
      for (const key of liveKeys) {
        const ts = tracker.get(key)
        if (ts !== undefined && now - ts > maxAgeMs) {
          toEvict.add(key)
        }
      }
    }

    // 2. LRU pass — if still over cap after TTL pruning, remove oldest
    if (maxEntries !== undefined) {
      const surviving = liveKeys.filter((k) => !toEvict.has(k))
      if (surviving.length > maxEntries) {
        // Sort by access time ascending (oldest first)
        const sorted = surviving.slice().sort((a, b) => {
          const ta = tracker.get(a) ?? 0
          const tb = tracker.get(b) ?? 0
          return ta - tb
        })
        const excess = surviving.length - maxEntries
        for (let i = 0; i < excess; i++) {
          toEvict.add(sorted[i])
        }
      }
    }

    return Array.from(toEvict)
  }

  const cleanup = (liveKeys: K[]): void => {
    const evictable = getEvictable(liveKeys)
    for (const key of evictable) {
      tracker.delete(key)
      onEvict?.(key)
    }
  }

  const startInterval = (getKeys: () => K[]): (() => void) => {
    const id = setInterval(() => {
      cleanup(getKeys())
    }, evictionInterval)
    return () => clearInterval(id)
  }

  const getAll = (): EvictableEntry<K>[] => {
    return Array.from(tracker.entries())
      .map(([key, lastAccessedAt]) => ({ key, lastAccessedAt }))
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
  }

  const size = (): number => tracker.size

  return { touch, delete: del, shouldEvict, getEvictable, cleanup, startInterval, getAll, size }
}
