/**
 * File Change Store — tracks which files were modified during a Claude run.
 * Used by the File Change Interceptor to show post-run summaries.
 */

import { create } from 'zustand'

export interface FileChange {
  filePath: string
  toolName: string
  timestamp: number
  messageId: string
}

interface FileChangeState {
  /** Per-tab file changes */
  changes: Record<string, FileChange[]>
  /** Track a file change for a tab */
  trackChange: (tabId: string, change: FileChange) => void
  /** Get changes for a tab */
  getChanges: (tabId: string) => FileChange[]
  /** Clear changes for a tab */
  clearChanges: (tabId: string) => void
}

/** Maximum tracked changes per tab */
const MAX_CHANGES_PER_TAB = 200

export const useFileChangeStore = create<FileChangeState>((set, get) => ({
  changes: {},

  trackChange: (tabId, change) => {
    set((state) => {
      const existing = state.changes[tabId] || []
      const updated = [...existing, change]
      // Bound the array
      const bounded = updated.length > MAX_CHANGES_PER_TAB
        ? updated.slice(-MAX_CHANGES_PER_TAB)
        : updated
      return { changes: { ...state.changes, [tabId]: bounded } }
    })
  },

  getChanges: (tabId) => {
    return get().changes[tabId] || []
  },

  clearChanges: (tabId) => {
    set((state) => {
      const { [tabId]: _, ...rest } = state.changes
      return { changes: rest }
    })
  },
}))
