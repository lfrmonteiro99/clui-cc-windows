import { create } from 'zustand'
import type { TerminalTab, TerminalCreateOptions } from '../../shared/types'
import type { PersistedSession } from '../utils/terminal-persistence'
import { loadTerminalSessions, deleteTerminalSession } from '../utils/terminal-persistence'

const STORAGE_KEY = 'clui-terminal-mode'
const SETTINGS_KEY = 'clui-terminal-settings'

interface TerminalSettings {
  scrollbackSize: number
  bellEnabled: boolean
  autoNaming: boolean
  backgroundOpacity: number
  backgroundBlur: number
  imageProtocolEnabled: boolean
  terminalScheme: string
}

const DEFAULT_SETTINGS: TerminalSettings = {
  scrollbackSize: 5000,
  bellEnabled: true,
  autoNaming: true,
  backgroundOpacity: 1,
  backgroundBlur: 0,
  imageProtocolEnabled: false,
  terminalScheme: 'Default',
}

function loadSettings(): TerminalSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
  } catch (err) {
    console.warn('[terminalStore] Failed to load settings:', err)
  }
  return { ...DEFAULT_SETTINGS }
}

function saveSettings(settings: Partial<TerminalSettings>): void {
  try {
    const current = loadSettings()
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...settings }))
  } catch (err) {
    console.warn('[terminalStore] Failed to save settings:', err)
  }
}

interface TerminalState {
  termTabs: TerminalTab[]
  activeTermTabId: string | null
  terminalMode: boolean
  ptyAvailable: boolean | null
  fontSize: number

  // Settings (TERM-004, TERM-008, TERM-010, TERM-012)
  scrollbackSize: number
  bellEnabled: boolean
  autoNaming: boolean
  backgroundOpacity: number
  backgroundBlur: number
  imageProtocolEnabled: boolean
  terminalScheme: string
  settingsOpen: boolean

  // Tab overview (TERM-006)
  overviewOpen: boolean

  // Split panes (TERM-002)
  paneLayouts: Record<string, PaneNode>

  checkAvailability: () => Promise<void>
  toggleMode: () => void
  createTermTab: (options?: TerminalCreateOptions) => Promise<string>
  closeTermTab: (id: string) => void
  setActiveTermTab: (id: string) => void
  handleTerminalExit: (termTabId: string, exitCode: number) => void
  setFontSize: (size: number) => void

  // TERM-003: Tab auto-naming
  updateTermTabTitle: (termTabId: string, title: string) => void

  // TERM-004: Configurable scrollback
  setScrollbackSize: (size: number) => void

  // TERM-008: Bell support
  incrementBellCount: (termTabId: string) => void
  clearBellCount: (termTabId: string) => void

  // TERM-010: Opacity
  setBackgroundOpacity: (opacity: number) => void
  setBackgroundBlur: (blur: number) => void

  // TERM-012: Settings panel
  setSettingsOpen: (open: boolean) => void
  setBellEnabled: (enabled: boolean) => void
  setAutoNaming: (enabled: boolean) => void
  setImageProtocolEnabled: (enabled: boolean) => void
  setTerminalScheme: (name: string) => void
  resetSettings: () => void

  // TERM-006: Tab overview
  setTabOverviewOpen: (open: boolean) => void
  selectTabFromOverview: (id: string) => void

  // TERM-002: Split panes
  splitPane: (termTabId: string, direction: 'horizontal' | 'vertical') => Promise<void>
  closeSplitPane: (termTabId: string, paneId: string) => void

  // TERM-007: Session persistence
  persistedSessions: PersistedSession[]
  loadPersistedSessions: () => Promise<void>
  restoreSession: (sessionId: string) => Promise<void>
  dismissPersistedSession: (sessionId: string) => void
  dismissAllPersistedSessions: () => void
}

// TERM-002: Split pane types
export type PaneNode =
  | { type: 'leaf'; paneId: string; termTabId: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; ratio: number; first: PaneNode; second: PaneNode }

function loadPersistedMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function countLeaves(node: PaneNode): number {
  if (node.type === 'leaf') return 1
  return countLeaves(node.first) + countLeaves(node.second)
}

export const useTerminalStore = create<TerminalState>((set, get) => {
  const settings = loadSettings()

  return {
    termTabs: [],
    activeTermTabId: null,
    terminalMode: false,
    ptyAvailable: null,
    fontSize: 13,

    // Settings
    scrollbackSize: settings.scrollbackSize,
    bellEnabled: settings.bellEnabled,
    autoNaming: settings.autoNaming,
    backgroundOpacity: settings.backgroundOpacity,
    backgroundBlur: settings.backgroundBlur,
    imageProtocolEnabled: settings.imageProtocolEnabled,
    terminalScheme: settings.terminalScheme,
    settingsOpen: false,

    overviewOpen: false,
    paneLayouts: {},
    persistedSessions: [],

    checkAvailability: async () => {
      try {
        const available = await window.clui.terminalAvailable()
        set({ ptyAvailable: available })
        if (available && loadPersistedMode()) {
          set({ terminalMode: true })
        }
      } catch {
        set({ ptyAvailable: false })
      }
    },

    toggleMode: () => {
      const { ptyAvailable } = get()
      if (!ptyAvailable) return
      set((s) => {
        const next = !s.terminalMode
        try { localStorage.setItem(STORAGE_KEY, String(next)) } catch (err) { console.warn('[terminalStore] persist mode failed:', err) }
        return { terminalMode: next }
      })
    },

    createTermTab: async (options?: TerminalCreateOptions) => {
      const result = await window.clui.terminalCreate(options)
      if (!result.termTabId) {
        throw new Error(result.error || 'Failed to create terminal')
      }

      const shell = options?.shell || (navigator.platform.includes('Win') ? 'cmd.exe' : 'bash')
      const cwd = options?.cwd || '~'

      const tab: TerminalTab = {
        id: result.termTabId,
        title: shell.split(/[\\/]/).pop() || shell,
        shell,
        cwd,
        status: 'active',
        exitCode: null,
        bellCount: 0,
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
        const newLayouts = { ...s.paneLayouts }
        delete newLayouts[id]
        return { termTabs: remaining, activeTermTabId: newActive, paneLayouts: newLayouts }
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

    setFontSize: (size: number) => {
      const clamped = Math.max(9, Math.min(24, size))
      set({ fontSize: clamped })
      window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: 'font-size-changed', fontSize: clamped } }))
    },

    // TERM-003: Tab auto-naming
    updateTermTabTitle: (termTabId: string, title: string) => {
      const { autoNaming } = get()
      if (!autoNaming) return
      set((s) => ({
        termTabs: s.termTabs.map((t) =>
          t.id === termTabId ? { ...t, title } : t
        ),
      }))
    },

    // TERM-004: Configurable scrollback
    setScrollbackSize: (size: number) => {
      const clamped = Math.max(1000, Math.min(50000, size))
      set({ scrollbackSize: clamped })
      saveSettings({ scrollbackSize: clamped })
      window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: 'scrollback-changed', scrollbackSize: clamped } }))
    },

    // TERM-008: Bell support
    incrementBellCount: (termTabId: string) => {
      set((s) => ({
        termTabs: s.termTabs.map((t) =>
          t.id === termTabId ? { ...t, bellCount: Math.min((t.bellCount ?? 0) + 1, 99) } : t
        ),
      }))
    },

    clearBellCount: (termTabId: string) => {
      set((s) => ({
        termTabs: s.termTabs.map((t) =>
          t.id === termTabId ? { ...t, bellCount: 0 } : t
        ),
      }))
    },

    // TERM-010: Background opacity
    setBackgroundOpacity: (opacity: number) => {
      const clamped = Math.max(0.4, Math.min(1, opacity))
      set({ backgroundOpacity: clamped })
      saveSettings({ backgroundOpacity: clamped })
      window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: 'opacity-changed', opacity: clamped } }))
    },

    setBackgroundBlur: (blur: number) => {
      const clamped = Math.max(0, Math.min(16, blur))
      set({ backgroundBlur: clamped })
      saveSettings({ backgroundBlur: clamped })
    },

    // TERM-012: Settings panel
    setSettingsOpen: (open: boolean) => set({ settingsOpen: open }),

    setBellEnabled: (enabled: boolean) => {
      set({ bellEnabled: enabled })
      saveSettings({ bellEnabled: enabled })
    },

    setAutoNaming: (enabled: boolean) => {
      set({ autoNaming: enabled })
      saveSettings({ autoNaming: enabled })
    },

    setImageProtocolEnabled: (enabled: boolean) => {
      set({ imageProtocolEnabled: enabled })
      saveSettings({ imageProtocolEnabled: enabled })
    },

    setTerminalScheme: (name: string) => {
      set({ terminalScheme: name })
      saveSettings({ terminalScheme: name })
      window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: 'scheme-changed', scheme: name } }))
    },

    resetSettings: () => {
      set({
        scrollbackSize: DEFAULT_SETTINGS.scrollbackSize,
        bellEnabled: DEFAULT_SETTINGS.bellEnabled,
        autoNaming: DEFAULT_SETTINGS.autoNaming,
        backgroundOpacity: DEFAULT_SETTINGS.backgroundOpacity,
        backgroundBlur: DEFAULT_SETTINGS.backgroundBlur,
        imageProtocolEnabled: DEFAULT_SETTINGS.imageProtocolEnabled,
        terminalScheme: DEFAULT_SETTINGS.terminalScheme,
      })
      window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: 'scheme-changed', scheme: DEFAULT_SETTINGS.terminalScheme } }))
      try { localStorage.removeItem(SETTINGS_KEY) } catch (err) { console.warn('[terminalStore] reset settings failed:', err) }
    },

    // TERM-006: Tab overview
    setTabOverviewOpen: (open: boolean) => set({ overviewOpen: open }),

    selectTabFromOverview: (id: string) => {
      set({ activeTermTabId: id, overviewOpen: false })
    },

    // TERM-002: Split panes
    splitPane: async (termTabId: string, direction: 'horizontal' | 'vertical') => {
      const state = get()
      const existingLayout = state.paneLayouts[termTabId]
      if (existingLayout && countLeaves(existingLayout) >= 4) return // max 4 panes

      const result = await window.clui.terminalCreate()
      if (!result.termTabId) return

      const newPaneId = result.termTabId

      set((s) => {
        const current = s.paneLayouts[termTabId] || { type: 'leaf' as const, paneId: termTabId, termTabId }
        const newLayout: PaneNode = {
          type: 'split',
          direction,
          ratio: 0.5,
          first: current,
          second: { type: 'leaf', paneId: newPaneId, termTabId: newPaneId },
        }
        return {
          paneLayouts: { ...s.paneLayouts, [termTabId]: newLayout },
        }
      })
    },

    closeSplitPane: (termTabId: string, paneId: string) => {
      set((s) => {
        const layout = s.paneLayouts[termTabId]
        if (!layout || layout.type === 'leaf') return s

        // Find and remove the pane, keeping the sibling
        const removePaneFromLayout = (node: PaneNode): PaneNode | null => {
          if (node.type === 'leaf') return node.paneId === paneId ? null : node
          const first = removePaneFromLayout(node.first)
          const second = removePaneFromLayout(node.second)
          if (!first) return second
          if (!second) return first
          return { ...node, first, second }
        }

        const remaining = removePaneFromLayout(layout)
        if (!remaining) {
          const newLayouts = { ...s.paneLayouts }
          delete newLayouts[termTabId]
          return { paneLayouts: newLayouts }
        }
        return { paneLayouts: { ...s.paneLayouts, [termTabId]: remaining } }
      })

      // Close the PTY for the removed pane
      window.clui.terminalClose(paneId).catch(() => {})
    },

    // TERM-007: Session persistence
    loadPersistedSessions: async () => {
      try {
        const sessions = await loadTerminalSessions()
        set({ persistedSessions: sessions })
      } catch (err) {
        console.warn('[terminalStore] Failed to load persisted sessions:', err)
      }
    },

    restoreSession: async (sessionId: string) => {
      const { persistedSessions } = get()
      const session = persistedSessions.find((s) => s.id === sessionId)
      if (!session) return

      try {
        const result = await window.clui.terminalCreate({ shell: session.shell, cwd: session.cwd })
        if (!result.termTabId) return

        const tab: TerminalTab = {
          id: result.termTabId,
          title: session.shell.split(/[\\/]/).pop() || session.shell,
          shell: session.shell,
          cwd: session.cwd,
          status: 'active',
          exitCode: null,
          bellCount: 0,
        }

        set((s) => ({
          termTabs: [...s.termTabs, tab],
          activeTermTabId: result.termTabId,
          persistedSessions: s.persistedSessions.filter((p) => p.id !== sessionId),
        }))

        // Write persisted buffer to terminal for visual replay
        if (session.serializedBuffer) {
          window.dispatchEvent(new CustomEvent('clui-terminal-restore', {
            detail: { termTabId: result.termTabId, buffer: session.serializedBuffer },
          }))
        }

        await deleteTerminalSession(sessionId)
      } catch (err) {
        console.warn('[terminalStore] Failed to restore session:', err)
      }
    },

    dismissPersistedSession: (sessionId: string) => {
      set((s) => ({
        persistedSessions: s.persistedSessions.filter((p) => p.id !== sessionId),
      }))
      deleteTerminalSession(sessionId).catch(() => {})
    },

    dismissAllPersistedSessions: () => {
      const { persistedSessions } = get()
      set({ persistedSessions: [] })
      for (const session of persistedSessions) {
        deleteTerminalSession(session.id).catch(() => {})
      }
    },
  }
})
