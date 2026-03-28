import { create } from 'zustand'

interface CompanionState {
  enabled: boolean
  loading: boolean
  toggleEnabled: () => Promise<void>
  loadSettings: () => Promise<void>
}

export const useCompanionStore = create<CompanionState>((set, get) => ({
  enabled: false,
  loading: false,

  loadSettings: async () => {
    try {
      const enabled = await window.clui.companionGetSetting()
      set({ enabled })
    } catch (err) {
      console.warn('[CompanionStore] Failed to load settings:', err)
    }
  },

  toggleEnabled: async () => {
    const next = !get().enabled
    try {
      await window.clui.companionSetSetting(next)
      set({ enabled: next })
    } catch (err) {
      console.warn('[CompanionStore] Failed to toggle setting:', err)
    }
  },
}))
