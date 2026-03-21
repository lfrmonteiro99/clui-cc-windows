import { create } from 'zustand'

// ─── Types ───

export interface BudgetConfig {
  perTabMaxUsd: number | null
  dailyMaxUsd: number | null
  alertThreshold: number
}

interface BudgetStatus {
  dailySpentUsd: number
  perTabSpent: Record<string, number>
}

interface BudgetState {
  config: BudgetConfig
  status: BudgetStatus
  alertDismissed: boolean

  setConfig: (updates: Partial<BudgetConfig>) => void
  recordTabCost: (tabId: string, costUsd: number) => void
  isTabOverBudget: (tabId: string) => boolean
  isDailyOverBudget: () => boolean
  isDailyAlertTriggered: () => boolean
  isTabAlertTriggered: (tabId: string) => boolean
  getTabRemaining: (tabId: string) => number | null
  getDailyRemaining: () => number | null
  dismissAlert: () => void
  resetTab: (tabId: string) => void
}

// ─── Store ───

export const useBudgetStore = create<BudgetState>((set, get) => ({
  config: {
    perTabMaxUsd: 1.0,
    dailyMaxUsd: 10.0,
    alertThreshold: 0.8,
  },
  status: {
    dailySpentUsd: 0,
    perTabSpent: {},
  },
  alertDismissed: false,

  setConfig: (updates) => {
    set((s) => ({ config: { ...s.config, ...updates } }))
  },

  recordTabCost: (tabId, costUsd) => {
    set((s) => {
      const currentTab = s.status.perTabSpent[tabId] || 0
      return {
        status: {
          dailySpentUsd: s.status.dailySpentUsd + costUsd,
          perTabSpent: {
            ...s.status.perTabSpent,
            [tabId]: currentTab + costUsd,
          },
        },
        alertDismissed: false, // reset dismiss on new cost
      }
    })
  },

  isTabOverBudget: (tabId) => {
    const { config, status } = get()
    if (config.perTabMaxUsd === null) return false
    return (status.perTabSpent[tabId] || 0) >= config.perTabMaxUsd
  },

  isDailyOverBudget: () => {
    const { config, status } = get()
    if (config.dailyMaxUsd === null) return false
    return status.dailySpentUsd >= config.dailyMaxUsd
  },

  isDailyAlertTriggered: () => {
    const { config, status } = get()
    if (config.dailyMaxUsd === null) return false
    return status.dailySpentUsd >= config.dailyMaxUsd * config.alertThreshold
  },

  isTabAlertTriggered: (tabId) => {
    const { config, status } = get()
    if (config.perTabMaxUsd === null) return false
    return (status.perTabSpent[tabId] || 0) >= config.perTabMaxUsd * config.alertThreshold
  },

  getTabRemaining: (tabId) => {
    const { config, status } = get()
    if (config.perTabMaxUsd === null) return null
    return Math.max(0, config.perTabMaxUsd - (status.perTabSpent[tabId] || 0))
  },

  getDailyRemaining: () => {
    const { config, status } = get()
    if (config.dailyMaxUsd === null) return null
    return Math.max(0, config.dailyMaxUsd - status.dailySpentUsd)
  },

  dismissAlert: () => set({ alertDismissed: true }),

  resetTab: (tabId) => {
    set((s) => {
      const { [tabId]: _, ...rest } = s.status.perTabSpent
      return {
        status: {
          ...s.status,
          perTabSpent: rest,
        },
      }
    })
  },
}))
