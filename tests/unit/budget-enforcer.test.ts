import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BudgetEnforcer, type BudgetConfig } from '../../src/main/budget-enforcer'

describe('BudgetEnforcer', () => {
  let enforcer: BudgetEnforcer

  beforeEach(() => {
    enforcer = new BudgetEnforcer()
  })

  // ─── Config ───

  it('starts with default config', () => {
    const config = enforcer.getConfig()
    expect(config.perTabMaxUsd).toBe(1.0)
    expect(config.dailyMaxUsd).toBe(10.0)
    expect(config.alertThreshold).toBe(0.8)
  })

  it('updates config', () => {
    enforcer.setConfig({ perTabMaxUsd: 5.0 })
    expect(enforcer.getConfig().perTabMaxUsd).toBe(5.0)
    expect(enforcer.getConfig().dailyMaxUsd).toBe(10.0) // unchanged
  })

  it('allows null to disable limits', () => {
    enforcer.setConfig({ perTabMaxUsd: null, dailyMaxUsd: null })
    expect(enforcer.getConfig().perTabMaxUsd).toBeNull()
    expect(enforcer.getConfig().dailyMaxUsd).toBeNull()
  })

  // ─── Recording costs ───

  it('records tab cost', () => {
    enforcer.recordCost('tab1', 0.50)
    expect(enforcer.getTabSpent('tab1')).toBe(0.50)
  })

  it('accumulates tab costs', () => {
    enforcer.recordCost('tab1', 0.30)
    enforcer.recordCost('tab1', 0.20)
    expect(enforcer.getTabSpent('tab1')).toBeCloseTo(0.50)
  })

  it('tracks daily total', () => {
    enforcer.recordCost('tab1', 0.50)
    enforcer.recordCost('tab2', 0.30)
    expect(enforcer.getDailySpent()).toBeCloseTo(0.80)
  })

  it('returns 0 for unknown tab', () => {
    expect(enforcer.getTabSpent('unknown')).toBe(0)
  })

  // ─── Budget checks ───

  it('detects tab over budget', () => {
    enforcer.setConfig({ perTabMaxUsd: 1.0 })
    enforcer.recordCost('tab1', 1.10)
    expect(enforcer.isTabOverBudget('tab1')).toBe(true)
  })

  it('tab under budget returns false', () => {
    enforcer.setConfig({ perTabMaxUsd: 1.0 })
    enforcer.recordCost('tab1', 0.50)
    expect(enforcer.isTabOverBudget('tab1')).toBe(false)
  })

  it('null perTabMaxUsd means no limit', () => {
    enforcer.setConfig({ perTabMaxUsd: null })
    enforcer.recordCost('tab1', 999)
    expect(enforcer.isTabOverBudget('tab1')).toBe(false)
  })

  it('detects daily over budget', () => {
    enforcer.setConfig({ dailyMaxUsd: 5.0 })
    enforcer.recordCost('tab1', 3.0)
    enforcer.recordCost('tab2', 2.5)
    expect(enforcer.isDailyOverBudget()).toBe(true)
  })

  it('null dailyMaxUsd means no limit', () => {
    enforcer.setConfig({ dailyMaxUsd: null })
    enforcer.recordCost('tab1', 999)
    expect(enforcer.isDailyOverBudget()).toBe(false)
  })

  // ─── Alert threshold ───

  it('detects daily alert threshold', () => {
    enforcer.setConfig({ dailyMaxUsd: 10.0, alertThreshold: 0.8 })
    enforcer.recordCost('tab1', 8.5)
    expect(enforcer.isDailyAlertTriggered()).toBe(true)
  })

  it('below daily alert threshold returns false', () => {
    enforcer.setConfig({ dailyMaxUsd: 10.0, alertThreshold: 0.8 })
    enforcer.recordCost('tab1', 7.0)
    expect(enforcer.isDailyAlertTriggered()).toBe(false)
  })

  it('detects tab alert threshold', () => {
    enforcer.setConfig({ perTabMaxUsd: 1.0, alertThreshold: 0.8 })
    enforcer.recordCost('tab1', 0.85)
    expect(enforcer.isTabAlertTriggered('tab1')).toBe(true)
  })

  // ─── Remaining budget ───

  it('computes remaining tab budget', () => {
    enforcer.setConfig({ perTabMaxUsd: 2.0 })
    enforcer.recordCost('tab1', 0.50)
    expect(enforcer.getTabRemaining('tab1')).toBeCloseTo(1.50)
  })

  it('computes remaining daily budget', () => {
    enforcer.setConfig({ dailyMaxUsd: 10.0 })
    enforcer.recordCost('tab1', 3.0)
    expect(enforcer.getDailyRemaining()).toBeCloseTo(7.0)
  })

  it('returns null remaining when limit is null', () => {
    enforcer.setConfig({ perTabMaxUsd: null })
    expect(enforcer.getTabRemaining('tab1')).toBeNull()
  })

  // ─── Budget for CLI injection ───

  it('returns per-tab remaining as CLI budget', () => {
    enforcer.setConfig({ perTabMaxUsd: 2.0 })
    enforcer.recordCost('tab1', 0.50)
    expect(enforcer.getCliBudgetForTab('tab1')).toBeCloseTo(1.50)
  })

  it('returns null when no tab limit', () => {
    enforcer.setConfig({ perTabMaxUsd: null })
    expect(enforcer.getCliBudgetForTab('tab1')).toBeNull()
  })

  it('returns 0.01 minimum when budget nearly exhausted', () => {
    enforcer.setConfig({ perTabMaxUsd: 1.0 })
    enforcer.recordCost('tab1', 0.999)
    const budget = enforcer.getCliBudgetForTab('tab1')
    expect(budget).toBeGreaterThanOrEqual(0.01)
  })

  // ─── Status snapshot ───

  it('returns full status snapshot', () => {
    enforcer.recordCost('tab1', 1.0)
    enforcer.recordCost('tab2', 2.0)
    const status = enforcer.getStatus()
    expect(status.dailySpentUsd).toBeCloseTo(3.0)
    expect(status.perTabSpent['tab1']).toBeCloseTo(1.0)
    expect(status.perTabSpent['tab2']).toBeCloseTo(2.0)
  })

  // ─── Reset ───

  it('resets tab spending', () => {
    enforcer.recordCost('tab1', 5.0)
    enforcer.resetTab('tab1')
    expect(enforcer.getTabSpent('tab1')).toBe(0)
  })

  it('resets daily spending', () => {
    enforcer.recordCost('tab1', 5.0)
    enforcer.resetDaily()
    expect(enforcer.getDailySpent()).toBe(0)
  })
})
