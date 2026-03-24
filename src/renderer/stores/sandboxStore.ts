import { create } from 'zustand'
import type {
  DirtyState,
  DiffSummary,
  WorktreeInfo,
  DirectoryListing,
  StashEntry,
  SandboxTabState,
} from '../../shared/sandbox-types'

export interface SandboxState {
  // Per-tab sandbox state
  tabStates: Map<string, SandboxTabState>

  // File tree
  fileTreeOpen: boolean
  fileTreeCwd: string | null
  fileTreeEntries: DirectoryListing | null
  fileTreeLoading: boolean

  // Stash browser
  stashBrowserOpen: boolean
  stashList: StashEntry[]
  stashLoading: boolean
  selectedStashIndex: number | null
  stashDiff: string | null

  // Dirty warning
  pendingDirtyWarning: { tabId: string; runId: string; dirty: DirtyState } | null

  // Actions
  getTabState: (tabId: string) => SandboxTabState
  setEnabled: (tabId: string, enabled: boolean) => void
  setWorktree: (tabId: string, info: WorktreeInfo) => void
  setDiff: (tabId: string, diff: DiffSummary) => void
  setMergeStatus: (tabId: string, status: SandboxTabState['mergeStatus']) => void
  clearTabState: (tabId: string) => void

  setFileTreeOpen: (open: boolean) => void
  loadFileTree: (cwd: string, relativePath?: string) => Promise<void>

  setStashBrowserOpen: (open: boolean) => void
  loadStashes: (cwd: string) => Promise<void>
  loadStashDiff: (cwd: string, index: number) => Promise<void>

  setPendingDirtyWarning: (warning: SandboxState['pendingDirtyWarning']) => void
}

const DEFAULT_TAB_STATE: SandboxTabState = {
  enabled: false,
  activeWorktree: null,
  pendingDiff: null,
  mergeStatus: 'idle',
}

function updateTabState(
  tabStates: Map<string, SandboxTabState>,
  tabId: string,
  patch: Partial<SandboxTabState>,
): Map<string, SandboxTabState> {
  const existing = tabStates.get(tabId) ?? { ...DEFAULT_TAB_STATE }
  const next = new Map(tabStates)
  next.set(tabId, { ...existing, ...patch })
  return next
}

export const useSandboxStore = create<SandboxState>((set, get) => ({
  // Per-tab sandbox state
  tabStates: new Map(),

  // File tree
  fileTreeOpen: false,
  fileTreeCwd: null,
  fileTreeEntries: null,
  fileTreeLoading: false,

  // Stash browser
  stashBrowserOpen: false,
  stashList: [],
  stashLoading: false,
  selectedStashIndex: null,
  stashDiff: null,

  // Dirty warning
  pendingDirtyWarning: null,

  // ─── Actions ───

  getTabState: (tabId) => {
    return get().tabStates.get(tabId) ?? { ...DEFAULT_TAB_STATE }
  },

  setEnabled: (tabId, enabled) => {
    set((s) => ({
      tabStates: updateTabState(s.tabStates, tabId, { enabled }),
    }))
  },

  setWorktree: (tabId, info) => {
    set((s) => ({
      tabStates: updateTabState(s.tabStates, tabId, {
        enabled: true,
        activeWorktree: info,
      }),
    }))
  },

  setDiff: (tabId, diff) => {
    set((s) => ({
      tabStates: updateTabState(s.tabStates, tabId, { pendingDiff: diff }),
    }))
  },

  setMergeStatus: (tabId, status) => {
    set((s) => ({
      tabStates: updateTabState(s.tabStates, tabId, { mergeStatus: status }),
    }))
  },

  clearTabState: (tabId) => {
    set((s) => {
      const next = new Map(s.tabStates)
      next.delete(tabId)
      return { tabStates: next }
    })
  },

  setFileTreeOpen: (open) => {
    set({ fileTreeOpen: open })
  },

  loadFileTree: async (cwd, relativePath) => {
    set({ fileTreeLoading: true, fileTreeCwd: cwd })
    try {
      const api = window.clui as unknown as Record<string, unknown>
      if (typeof api.sandboxListFiles !== 'function') {
        throw new Error('sandboxListFiles not available')
      }
      const listing = await (api.sandboxListFiles as (cwd: string, relativePath?: string) => Promise<DirectoryListing>)(cwd, relativePath)
      set({ fileTreeEntries: listing, fileTreeLoading: false })
    } catch {
      set({ fileTreeEntries: null, fileTreeLoading: false })
    }
  },

  setStashBrowserOpen: (open) => {
    set({ stashBrowserOpen: open })
  },

  loadStashes: async (cwd) => {
    set({ stashLoading: true })
    try {
      const api = window.clui as unknown as Record<string, unknown>
      if (typeof api.sandboxListStashes !== 'function') {
        throw new Error('sandboxListStashes not available')
      }
      const stashes = await (api.sandboxListStashes as (cwd: string) => Promise<StashEntry[]>)(cwd)
      set({ stashList: stashes, stashLoading: false })
    } catch {
      set({ stashList: [], stashLoading: false })
    }
  },

  loadStashDiff: async (cwd, index) => {
    set({ selectedStashIndex: index, stashDiff: null })
    try {
      const api = window.clui as unknown as Record<string, unknown>
      if (typeof api.sandboxGetStashDiff !== 'function') {
        throw new Error('sandboxGetStashDiff not available')
      }
      const diff = await (api.sandboxGetStashDiff as (cwd: string, index: number) => Promise<string>)(cwd, index)
      set({ stashDiff: diff })
    } catch {
      set({ stashDiff: null })
    }
  },

  setPendingDirtyWarning: (warning) => {
    set({ pendingDirtyWarning: warning })
  },
}))
