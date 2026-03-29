import { create } from 'zustand'

const MAX_HISTORY = 100

interface PromptHistoryState {
  /** Per-tab prompt history (newest first) */
  histories: Record<string, string[]>
  /** Per-tab navigation index (-1 = not navigating) */
  indices: Record<string, number>
  /** Per-tab saved draft (current input before navigating) */
  drafts: Record<string, string>

  pushPrompt: (tabId: string, text: string) => void
  navigateUp: (tabId: string, currentInput: string) => string | null
  navigateDown: (tabId: string) => string | null
  resetIndex: (tabId: string) => void
  clearTab: (tabId: string) => void
}

export const usePromptHistoryStore = create<PromptHistoryState>((set, get) => ({
  histories: {},
  indices: {},
  drafts: {},

  pushPrompt: (tabId, text) => {
    if (!text.trim()) return
    const state = get()
    const prev = state.histories[tabId] ?? []
    // Deduplicate: remove if already at front
    const deduped = prev[0] === text ? prev : [text, ...prev]
    const capped = deduped.slice(0, MAX_HISTORY)
    set({
      histories: { ...state.histories, [tabId]: capped },
    })
  },

  navigateUp: (tabId, currentInput) => {
    const state = get()
    const history = state.histories[tabId]
    if (!history || history.length === 0) return null

    const currentIndex = state.indices[tabId] ?? -1
    const nextIndex = currentIndex + 1

    if (nextIndex >= history.length) return null

    const updates: Partial<PromptHistoryState> = {
      indices: { ...state.indices, [tabId]: nextIndex },
    }

    // Save draft when first navigating away from input
    if (currentIndex === -1) {
      updates.drafts = { ...state.drafts, [tabId]: currentInput }
    }

    set(updates as PromptHistoryState)
    return history[nextIndex]
  },

  navigateDown: (tabId) => {
    const state = get()
    const currentIndex = state.indices[tabId] ?? -1

    if (currentIndex <= -1) return null

    const nextIndex = currentIndex - 1
    set({
      indices: { ...state.indices, [tabId]: nextIndex },
    })

    if (nextIndex === -1) {
      return state.drafts[tabId] ?? ''
    }

    const history = state.histories[tabId] ?? []
    return history[nextIndex] ?? null
  },

  resetIndex: (tabId) => {
    const state = get()
    set({
      indices: { ...state.indices, [tabId]: -1 },
    })
  },

  clearTab: (tabId) => {
    const state = get()
    const { [tabId]: _h, ...histories } = state.histories
    const { [tabId]: _i, ...indices } = state.indices
    const { [tabId]: _d, ...drafts } = state.drafts
    set({ histories, indices, drafts })
  },
}))
