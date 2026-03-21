import { create } from 'zustand'

// ─── Types ───

interface CacheStats {
  hits: number
  misses: number
  savedUsd: number
}

interface CacheState {
  enabled: boolean
  ttlMs: number
  maxEntries: number
  stats: CacheStats

  setEnabled: (on: boolean) => void
  setTtl: (ms: number) => void
  recordHit: (savedUsd: number) => void
  recordMiss: () => void
  getHitRate: () => number
  resetStats: () => void
}

// ─── Store ───

export const useCacheStore = create<CacheState>((set, get) => ({
  enabled: true,
  ttlMs: 3_600_000, // 1 hour
  maxEntries: 200,
  stats: { hits: 0, misses: 0, savedUsd: 0 },

  setEnabled: (on) => set({ enabled: on }),

  setTtl: (ms) => set({ ttlMs: ms }),

  recordHit: (savedUsd) => {
    set((s) => ({
      stats: {
        hits: s.stats.hits + 1,
        misses: s.stats.misses,
        savedUsd: s.stats.savedUsd + savedUsd,
      },
    }))
  },

  recordMiss: () => {
    set((s) => ({
      stats: {
        ...s.stats,
        misses: s.stats.misses + 1,
      },
    }))
  },

  getHitRate: () => {
    const { hits, misses } = get().stats
    const total = hits + misses
    if (total === 0) return 0
    return hits / total
  },

  resetStats: () => {
    set({ stats: { hits: 0, misses: 0, savedUsd: 0 } })
  },
}))
