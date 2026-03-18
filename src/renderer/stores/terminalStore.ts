import { create } from 'zustand'
import type { TerminalTab, TerminalCreateOptions } from '../../shared/types'

interface TerminalState {
  termTabs: TerminalTab[]
  activeTermTabId: string | null
  terminalMode: boolean

  toggleMode: () => void
  createTermTab: (options?: TerminalCreateOptions) => Promise<string>
  closeTermTab: (id: string) => void
  setActiveTermTab: (id: string) => void
  handleTerminalExit: (termTabId: string, exitCode: number) => void
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  termTabs: [],
  activeTermTabId: null,
  terminalMode: false,

  toggleMode: () => set((s) => ({ terminalMode: !s.terminalMode })),

  createTermTab: async (options?: TerminalCreateOptions) => {
    const result = await window.clui.terminalCreate(options)
    if (!result.termTabId) {
      throw new Error(result.error || 'Failed to create terminal')
    }

    const shell = options?.shell || (process.platform === 'win32' ? 'cmd.exe' : 'bash')
    const cwd = options?.cwd || '~'

    const tab: TerminalTab = {
      id: result.termTabId,
      title: shell.split(/[\\/]/).pop() || shell,
      shell,
      cwd,
      status: 'active',
      exitCode: null,
    }

    set((s) => ({
      termTabs: [...s.termTabs, tab],
      activeTermTabId: result.termTabId,
    }))

    return result.termTabId!
  },

  closeTermTab: (id: string) => {
    window.clui.terminalClose(id).catch(() => {})
    set((s) => {
      const remaining = s.termTabs.filter((t) => t.id !== id)
      const newActive = s.activeTermTabId === id
        ? remaining[remaining.length - 1]?.id ?? null
        : s.activeTermTabId
      return { termTabs: remaining, activeTermTabId: newActive }
    })
  },

  setActiveTermTab: (id: string) => set({ activeTermTabId: id }),

  handleTerminalExit: (termTabId: string, exitCode: number) => {
    set((s) => ({
      termTabs: s.termTabs.map((t) =>
        t.id === termTabId ? { ...t, status: 'exited' as const, exitCode } : t
      ),
    }))
  },
}))
