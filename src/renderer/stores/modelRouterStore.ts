import { create } from 'zustand'
import { classifyPrompt, type ClassifierThresholds } from '../../shared/prompt-classifier'

// ─── Types ───

interface RoutingEntry {
  timestamp: number
  tabId: string
  score: number
  model: string
}

interface SavingsEstimate {
  routedToHaiku: number
  routedToSonnet: number
  routedToOpus: number
  totalRouted: number
}

interface ModelRouterState {
  enabled: boolean
  mode: 'auto' | 'manual'
  overrides: Record<string, string>      // per-tab model overrides
  thresholds: ClassifierThresholds
  routingHistory: RoutingEntry[]

  setEnabled: (on: boolean) => void
  setMode: (mode: 'auto' | 'manual') => void
  setTabOverride: (tabId: string, model: string | null) => void
  setThresholds: (thresholds: ClassifierThresholds) => void
  resolveModel: (tabId: string, prompt: string, preferredModel: string | null) => string
  getLastRouting: (tabId: string) => { score: number; model: string } | null
  getSavingsEstimate: () => SavingsEstimate
}

// ─── Constants ───

const MAX_HISTORY = 50
const DEFAULT_THRESHOLDS: ClassifierThresholds = { haiku: 30, sonnet: 65 }

// ─── Store ───

export const useModelRouterStore = create<ModelRouterState>((set, get) => ({
  enabled: true,
  mode: 'auto',
  overrides: {},
  thresholds: DEFAULT_THRESHOLDS,
  routingHistory: [],

  setEnabled: (on) => set({ enabled: on }),

  setMode: (mode) => set({ mode }),

  setTabOverride: (tabId, model) => {
    set((s) => {
      if (model === null) {
        const { [tabId]: _, ...rest } = s.overrides
        return { overrides: rest }
      }
      return { overrides: { ...s.overrides, [tabId]: model } }
    })
  },

  setThresholds: (thresholds) => set({ thresholds }),

  resolveModel: (tabId, prompt, preferredModel) => {
    const { enabled, mode, overrides, thresholds } = get()

    // Manual mode or disabled → use user's preferred model
    if (!enabled || mode === 'manual') {
      return preferredModel || 'claude-sonnet-4-6'
    }

    // Per-tab override takes priority
    if (overrides[tabId]) {
      return overrides[tabId]
    }

    // Auto-classify
    const classification = classifyPrompt(prompt, {}, thresholds)
    const resolvedModel = classification.suggestedModel

    // Record to history
    set((s) => {
      const entry: RoutingEntry = {
        timestamp: Date.now(),
        tabId,
        score: classification.score,
        model: resolvedModel,
      }
      const history = [entry, ...s.routingHistory].slice(0, MAX_HISTORY)
      return { routingHistory: history }
    })

    return resolvedModel
  },

  getLastRouting: (tabId) => {
    const entry = get().routingHistory.find((e) => e.tabId === tabId)
    if (!entry) return null
    return { score: entry.score, model: entry.model }
  },

  getSavingsEstimate: () => {
    const { routingHistory } = get()
    const estimate: SavingsEstimate = {
      routedToHaiku: 0,
      routedToSonnet: 0,
      routedToOpus: 0,
      totalRouted: routingHistory.length,
    }
    for (const entry of routingHistory) {
      if (entry.model === 'claude-haiku-4-5-20251001') estimate.routedToHaiku++
      else if (entry.model === 'claude-sonnet-4-6') estimate.routedToSonnet++
      else estimate.routedToOpus++
    }
    return estimate
  },
}))
