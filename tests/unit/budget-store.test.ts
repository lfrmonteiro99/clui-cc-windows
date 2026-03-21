import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useBudgetStore } from '../../src/renderer/stores/budgetStore'

describe('budgetStore', () => {
  beforeEach(() => {
    useBudgetStore.setState({
      config: { perTabMaxUsd: 1.0, dailyMaxUsd: 10.0, alertThreshold: 0.8 },
      status: { dailySpentUsd: 0, perTabSpent: {} },
      alertDismissed: false,
    })
  })

  // ─── Config ───

  it('has default config', () => {
    const { config } = useBudgetStore.getState()
    expect(config.perTabMaxUsd).toBe(1.0)
    expect(config.dailyMaxUsd).toBe(10.0)
    expect(config.alertThreshold).toBe(0.8)
  })

  it('updates config partially', () => {
    useBudgetStore.getState().setConfig({ perTabMaxUsd: 5.0 })
    expect(useBudgetStore.getState().config.perTabMaxUsd).toBe(5.0)
    expect(useBudgetStore.getState().config.dailyMaxUsd).toBe(10.0) // unchanged
  })

  // ─── Recording costs ───

  it('records tab cost and updates daily total', () => {
    useBudgetStore.getState().recordTabCost('tab1', 0.50)
    const { status } = useBudgetStore.getState()
    expect(status.perTabSpent['tab1']).toBeCloseTo(0.50)
    expect(status.dailySpentUsd).toBeCloseTo(0.50)
  })

  it('accumulates costs across tabs', () => {
    useBudgetStore.getState().recordTabCost('tab1', 0.30)
    useBudgetStore.getState().recordTabCost('tab2', 0.20)
    expect(useBudgetStore.getState().status.dailySpentUsd).toBeCloseTo(0.50)
  })

  it('accumulates costs within a tab', () => {
    useBudgetStore.getState().recordTabCost('tab1', 0.30)
    useBudgetStore.getState().recordTabCost('tab1', 0.20)
    expect(useBudgetStore.getState().status.perTabSpent['tab1']).toBeCloseTo(0.50)
  })

  // ─── Budget checks ───

  it('detects tab over budget', () => {
    useBudgetStore.getState().recordTabCost('tab1', 1.10)
    expect(useBudgetStore.getState().isTabOverBudget('tab1')).toBe(true)
  })

  it('tab under budget returns false', () => {
    useBudgetStore.getState().recordTabCost('tab1', 0.50)
    expect(useBudgetStore.getState().isTabOverBudget('tab1')).toBe(false)
  })

  it('null perTabMaxUsd means unlimited', () => {
    useBudgetStore.getState().setConfig({ perTabMaxUsd: null })
    useBudgetStore.getState().recordTabCost('tab1', 999)
    expect(useBudgetStore.getState().isTabOverBudget('tab1')).toBe(false)
  })

  it('detects daily over budget', () => {
    useBudgetStore.getState().recordTabCost('tab1', 6.0)
    useBudgetStore.getState().recordTabCost('tab2', 5.0)
    expect(useBudgetStore.getState().isDailyOverBudget()).toBe(true)
  })

  it('null dailyMaxUsd means unlimited', () => {
    useBudgetStore.getState().setConfig({ dailyMaxUsd: null })
    useBudgetStore.getState().recordTabCost('tab1', 999)
    expect(useBudgetStore.getState().isDailyOverBudget()).toBe(false)
  })

  // ─── Alert threshold ───

  it('detects daily alert threshold', () => {
    useBudgetStore.getState().recordTabCost('tab1', 8.5)
    expect(useBudgetStore.getState().isDailyAlertTriggered()).toBe(true)
  })

  it('below daily alert threshold returns false', () => {
    useBudgetStore.getState().recordTabCost('tab1', 7.0)
    expect(useBudgetStore.getState().isDailyAlertTriggered()).toBe(false)
  })

  it('detects tab alert threshold', () => {
    useBudgetStore.getState().recordTabCost('tab1', 0.85)
    expect(useBudgetStore.getState().isTabAlertTriggered('tab1')).toBe(true)
  })

  // ─── Remaining budget ───

  it('computes remaining tab budget', () => {
    useBudgetStore.getState().recordTabCost('tab1', 0.50)
    expect(useBudgetStore.getState().getTabRemaining('tab1')).toBeCloseTo(0.50)
  })

  it('computes remaining daily budget', () => {
    useBudgetStore.getState().recordTabCost('tab1', 3.0)
    expect(useBudgetStore.getState().getDailyRemaining()).toBeCloseTo(7.0)
  })

  it('returns null for unlimited tab budget', () => {
    useBudgetStore.getState().setConfig({ perTabMaxUsd: null })
    expect(useBudgetStore.getState().getTabRemaining('tab1')).toBeNull()
  })

  it('returns null for unlimited daily budget', () => {
    useBudgetStore.getState().setConfig({ dailyMaxUsd: null })
    expect(useBudgetStore.getState().getDailyRemaining()).toBeNull()
  })

  // ─── Alert dismiss ───

  it('dismisses alert', () => {
    useBudgetStore.getState().dismissAlert()
    expect(useBudgetStore.getState().alertDismissed).toBe(true)
  })

  it('resets dismiss when new cost recorded', () => {
    useBudgetStore.getState().dismissAlert()
    useBudgetStore.getState().recordTabCost('tab1', 0.10)
    expect(useBudgetStore.getState().alertDismissed).toBe(false)
  })

  // ─── Reset ───

  it('resets tab spending', () => {
    useBudgetStore.getState().recordTabCost('tab1', 5.0)
    useBudgetStore.getState().resetTab('tab1')
    expect(useBudgetStore.getState().status.perTabSpent['tab1']).toBeUndefined()
  })
})
