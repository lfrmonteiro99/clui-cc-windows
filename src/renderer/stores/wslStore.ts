import { create } from 'zustand'

export interface WslDistroInfo {
  name: string
  isDefault: boolean
  state: 'Running' | 'Stopped' | 'Installing'
  version: 1 | 2
  hasClaude: boolean | null
}

interface WslState {
  available: boolean
  distros: WslDistroInfo[]
  initialized: boolean
  init: () => Promise<void>
  checkClaude: (distro: string) => Promise<boolean>
  getDefaultDistro: () => string | null
  browseWsl: (distro: string) => Promise<string | null>
}

export const useWslStore = create<WslState>((set, get) => ({
  available: false,
  distros: [],
  initialized: false,

  init: async () => {
    if (get().initialized) return
    try {
      const status = await window.clui.wslStatus()
      set({
        available: status.available,
        distros: status.distros.map((d) => ({
          name: d.name,
          isDefault: d.isDefault,
          state: d.state,
          version: d.version,
          hasClaude: d.hasClaude,
        })),
        initialized: true,
      })
    } catch {
      set({ available: false, distros: [], initialized: true })
    }
  },

  checkClaude: async (distro: string) => {
    try {
      const result = await window.clui.wslCheckClaude(distro)
      set((s) => ({
        distros: s.distros.map((d) =>
          d.name === distro ? { ...d, hasClaude: result } : d,
        ),
      }))
      return result
    } catch {
      set((s) => ({
        distros: s.distros.map((d) =>
          d.name === distro ? { ...d, hasClaude: false } : d,
        ),
      }))
      return false
    }
  },

  getDefaultDistro: () => {
    const { distros } = get()
    const defaultDistro = distros.find((d) => d.isDefault)
    return defaultDistro?.name ?? null
  },

  browseWsl: async (distro: string) => {
    try {
      return await window.clui.wslBrowse(distro)
    } catch {
      return null
    }
  },
}))
