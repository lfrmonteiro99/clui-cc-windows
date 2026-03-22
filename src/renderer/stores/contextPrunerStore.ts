/**
 * Context Pruner Store — tracks which messages can be collapsed in the UI
 * to reduce visual clutter from redundant/stale context.
 */

import { create } from 'zustand'
import { analyzeForPruning, type PruneResult } from '../../shared/context-pruner'
import type { Message } from '../../shared/types'

interface ContextPrunerState {
  /** Per-tab pruning analysis results */
  pruneResults: Record<string, PruneResult>
  /** Per-tab collapsed message IDs */
  collapsedIds: Record<string, Set<string>>
  /** Analyze messages for pruning opportunities */
  analyzePruning: (tabId: string, messages: Message[]) => void
  /** Toggle collapse for a specific action's messages */
  toggleAction: (tabId: string, messageIds: string[]) => void
  /** Collapse all prunable messages in a tab */
  collapseAll: (tabId: string) => void
  /** Expand all collapsed messages in a tab */
  expandAll: (tabId: string) => void
  /** Check if a message is collapsed */
  isCollapsed: (tabId: string, messageId: string) => boolean
  /** Clear pruning data for a tab */
  clearTab: (tabId: string) => void
}

export const useContextPrunerStore = create<ContextPrunerState>((set, get) => ({
  pruneResults: {},
  collapsedIds: {},

  analyzePruning: (tabId, messages) => {
    const result = analyzeForPruning(messages)
    set((state) => ({
      pruneResults: { ...state.pruneResults, [tabId]: result },
    }))
  },

  toggleAction: (tabId, messageIds) => {
    set((state) => {
      const existing = state.collapsedIds[tabId] || new Set()
      const newSet = new Set(existing)

      // If all are collapsed, expand them; otherwise collapse all
      const allCollapsed = messageIds.every((id) => newSet.has(id))
      if (allCollapsed) {
        for (const id of messageIds) newSet.delete(id)
      } else {
        for (const id of messageIds) newSet.add(id)
      }

      return { collapsedIds: { ...state.collapsedIds, [tabId]: newSet } }
    })
  },

  collapseAll: (tabId) => {
    const result = get().pruneResults[tabId]
    if (!result) return

    const allIds = new Set<string>()
    for (const action of result.actions) {
      for (const id of action.messageIds) allIds.add(id)
    }

    set((state) => ({
      collapsedIds: { ...state.collapsedIds, [tabId]: allIds },
    }))
  },

  expandAll: (tabId) => {
    set((state) => ({
      collapsedIds: { ...state.collapsedIds, [tabId]: new Set() },
    }))
  },

  isCollapsed: (tabId, messageId) => {
    return get().collapsedIds[tabId]?.has(messageId) ?? false
  },

  clearTab: (tabId) => {
    set((state) => {
      const { [tabId]: _r, ...restResults } = state.pruneResults
      const { [tabId]: _c, ...restCollapsed } = state.collapsedIds
      return { pruneResults: restResults, collapsedIds: restCollapsed }
    })
  },
}))
