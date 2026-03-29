import { create } from 'zustand'
import type { SessionDigestStats } from '../../shared/types'

interface SessionDigestState {
  enabled: boolean
  stats: SessionDigestStats | null
  loading: boolean
  toggleEnabled: () => Promise<void>
  refreshStats: () => Promise<void>
  loadSettings: () => Promise<void>
}

export const useSessionDigestStore = create<SessionDigestState>((set, get) => ({
  enabled: false,
  stats: null,
  loading: false,

  loadSettings: async () => {
    try {
      const enabled = await window.clui.sessionDigestGetSetting()
      set({ enabled })
    } catch (err) {
      console.warn('[SessionDigestStore] Failed to load settings:', err)
    }
  },

  toggleEnabled: async () => {
    const next = !get().enabled
    try {
      await window.clui.sessionDigestSetSetting(next)
      set({ enabled: next })
    } catch (err) {
      console.warn('[SessionDigestStore] Failed to toggle setting:', err)
    }
  },

  refreshStats: async () => {
    try {
      set({ loading: true })
      const stats = await window.clui.sessionDigestGetStats()
      set({ stats, loading: false })
    } catch (err) {
      console.warn('[SessionDigestStore] Failed to refresh stats:', err)
      set({ loading: false })
    }
  },
}))
