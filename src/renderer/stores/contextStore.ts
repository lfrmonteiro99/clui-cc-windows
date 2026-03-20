import { create } from 'zustand'
import type {
  ContextMemory,
  ContextSessionSummary,
  ContextProjectStats,
  ContextFileTouched,
  MemorySearchResult,
} from '../../shared/context-types'

export interface ContextState {
  memories: MemorySearchResult[]
  sessionHistory: ContextSessionSummary[]
  projectStats: ContextProjectStats | null
  filesTouched: ContextFileTouched[]
  memoryPacketPreview: string | null
  searchQuery: string
  isLoading: boolean
  panelOpen: boolean
  activeSection: 'memories' | 'sessions' | 'files' | 'preview'

  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
  setActiveSection: (section: ContextState['activeSection']) => void
  setSearchQuery: (query: string) => void
  loadMemories: (projectPath: string, query?: string) => Promise<void>
  loadSessionHistory: (projectPath: string) => Promise<void>
  loadProjectStats: (projectPath: string) => Promise<void>
  loadFilesTouched: (projectPath: string) => Promise<void>
  loadPacketPreview: (projectPath: string, tabId: string, prompt: string) => Promise<void>
  pinMemory: (memoryId: string) => Promise<void>
  unpinMemory: (memoryId: string) => Promise<void>
  deleteMemory: (memoryId: string) => Promise<void>
  handleMemoryCreated: (memory: ContextMemory) => void
  handleSessionRecorded: (session: ContextSessionSummary) => void
}

export const useContextStore = create<ContextState>((set, get) => ({
  memories: [],
  sessionHistory: [],
  projectStats: null,
  filesTouched: [],
  memoryPacketPreview: null,
  searchQuery: '',
  isLoading: false,
  panelOpen: false,
  activeSection: 'memories',

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setActiveSection: (section) => set({ activeSection: section }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  loadMemories: async (projectPath, query) => {
    set({ isLoading: true })
    try {
      const memories = await window.clui.contextSearchMemories(projectPath, query || '', 50)
      set({ memories, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  loadSessionHistory: async (projectPath) => {
    set({ isLoading: true })
    try {
      const sessionHistory = await window.clui.contextGetSessionHistory(projectPath, 20, 0)
      set({ sessionHistory, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  loadProjectStats: async (projectPath) => {
    try {
      const projectStats = await window.clui.contextGetProjectStats(projectPath)
      set({ projectStats })
    } catch {
      // ignore
    }
  },

  loadFilesTouched: async (projectPath) => {
    set({ isLoading: true })
    try {
      const filesTouched = await window.clui.contextGetFilesTouched(projectPath, 50)
      set({ filesTouched, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  loadPacketPreview: async (projectPath, tabId, prompt) => {
    set({ isLoading: true })
    try {
      const memoryPacketPreview = await window.clui.contextGetMemoryPacketPreview(projectPath, tabId, prompt)
      set({ memoryPacketPreview, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  pinMemory: async (memoryId) => {
    try {
      await window.clui.contextPinMemory(memoryId)
      set((s) => ({
        memories: s.memories.map((m) =>
          m.id === memoryId ? { ...m, isPinned: true } : m,
        ),
      }))
    } catch {
      // ignore
    }
  },

  unpinMemory: async (memoryId) => {
    try {
      await window.clui.contextUnpinMemory(memoryId)
      set((s) => ({
        memories: s.memories.map((m) =>
          m.id === memoryId ? { ...m, isPinned: false } : m,
        ),
      }))
    } catch {
      // ignore
    }
  },

  deleteMemory: async (memoryId) => {
    try {
      await window.clui.contextDeleteMemory(memoryId)
      set((s) => ({
        memories: s.memories.filter((m) => m.id !== memoryId),
      }))
    } catch {
      // ignore
    }
  },

  handleMemoryCreated: (memory) => {
    set((s) => ({
      memories: [memory, ...s.memories],
    }))
  },

  handleSessionRecorded: (session) => {
    set((s) => ({
      sessionHistory: [session, ...s.sessionHistory],
    }))
  },
}))
