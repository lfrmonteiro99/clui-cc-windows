import { create } from 'zustand'
import type { UsageData } from '../../shared/types'

// ─── Constants ───

const DEFAULT_MAX_CONTEXT_TOKENS = 200_000
const WARN_THRESHOLD = 0.7
const CRITICAL_THRESHOLD = 0.85

// ─── Types ───

export interface TokenBudget {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  turns: number
  lastUpdated: number
}

export interface TokenCategory {
  label: string
  tokens: number
  percentage: number
  color: string
}

export type ThresholdLevel = 'normal' | 'warning' | 'critical'

interface TokenBudgetState {
  budgets: Record<string, TokenBudget>
  maxContextTokens: number

  recordUsage: (tabId: string, usage: Partial<UsageData>) => void
  getUtilization: (tabId: string) => number
  getThresholdLevel: (tabId: string) => ThresholdLevel
  getCategories: (tabId: string) => TokenCategory[]
  getHeadroom: (tabId: string) => number
  resetTab: (tabId: string) => void
  setMaxContextTokens: (max: number) => void
}

// ─── Category colors (theme-key references) ───

const CATEGORY_COLORS = {
  input: '#d97757',     // accent orange
  output: '#7aac8c',    // green
  cacheRead: '#6b9bd2',  // blue
  cacheWrite: '#c4a06e', // amber
} as const

// ─── Store ───

export const useTokenBudgetStore = create<TokenBudgetState>((set, get) => ({
  budgets: {},
  maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,

  recordUsage: (tabId, usage) => {
    set((s) => {
      const existing = s.budgets[tabId]
      const updated: TokenBudget = {
        inputTokens: (existing?.inputTokens ?? 0) + (usage.input_tokens ?? 0),
        outputTokens: (existing?.outputTokens ?? 0) + (usage.output_tokens ?? 0),
        cacheReadTokens: (existing?.cacheReadTokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
        cacheCreationTokens: (existing?.cacheCreationTokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
        turns: (existing?.turns ?? 0) + 1,
        lastUpdated: Date.now(),
      }
      return { budgets: { ...s.budgets, [tabId]: updated } }
    })
  },

  getUtilization: (tabId) => {
    const { budgets, maxContextTokens } = get()
    const budget = budgets[tabId]
    if (!budget) return 0
    return Math.min(budget.inputTokens / maxContextTokens, 1.0)
  },

  getThresholdLevel: (tabId) => {
    const util = get().getUtilization(tabId)
    if (util >= CRITICAL_THRESHOLD) return 'critical'
    if (util >= WARN_THRESHOLD) return 'warning'
    return 'normal'
  },

  getCategories: (tabId) => {
    const budget = get().budgets[tabId]
    if (!budget) return []

    const total = budget.inputTokens + budget.outputTokens + budget.cacheReadTokens + budget.cacheCreationTokens
    if (total === 0) return []

    const raw: Array<{ label: string; tokens: number; color: string }> = [
      { label: 'Input', tokens: budget.inputTokens, color: CATEGORY_COLORS.input },
      { label: 'Output', tokens: budget.outputTokens, color: CATEGORY_COLORS.output },
      { label: 'Cache Read', tokens: budget.cacheReadTokens, color: CATEGORY_COLORS.cacheRead },
      { label: 'Cache Write', tokens: budget.cacheCreationTokens, color: CATEGORY_COLORS.cacheWrite },
    ]

    return raw
      .filter((c) => c.tokens > 0)
      .map((c) => ({ ...c, percentage: c.tokens / total }))
  },

  getHeadroom: (tabId) => {
    const { budgets, maxContextTokens } = get()
    const budget = budgets[tabId]
    if (!budget) return maxContextTokens
    return Math.max(maxContextTokens - budget.inputTokens, 0)
  },

  resetTab: (tabId) => {
    set((s) => {
      const { [tabId]: _, ...rest } = s.budgets
      return { budgets: rest }
    })
  },

  setMaxContextTokens: (max) => {
    set({ maxContextTokens: max })
  },
}))
