// ─── Budget Enforcer (Main Process) ───
// Per-tab and daily budget tracking with alert thresholds.

export interface BudgetConfig {
  perTabMaxUsd: number | null     // null = unlimited
  dailyMaxUsd: number | null      // null = unlimited
  alertThreshold: number           // 0-1 fraction, default 0.8
}

export interface BudgetStatus {
  dailySpentUsd: number
  perTabSpent: Record<string, number>
}

const DEFAULT_CONFIG: BudgetConfig = {
  perTabMaxUsd: 1.0,
  dailyMaxUsd: 10.0,
  alertThreshold: 0.8,
}

export class BudgetEnforcer {
  private config: BudgetConfig
  private tabSpent: Map<string, number> = new Map()
  private dailySpent = 0

  constructor(config?: Partial<BudgetConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ─── Config ───

  getConfig(): BudgetConfig {
    return { ...this.config }
  }

  setConfig(updates: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...updates }
  }

  // ─── Recording ───

  recordCost(tabId: string, costUsd: number): void {
    const current = this.tabSpent.get(tabId) || 0
    this.tabSpent.set(tabId, current + costUsd)
    this.dailySpent += costUsd
  }

  // ─── Getters ───

  getTabSpent(tabId: string): number {
    return this.tabSpent.get(tabId) || 0
  }

  getDailySpent(): number {
    return this.dailySpent
  }

  // ─── Budget checks ───

  isTabOverBudget(tabId: string): boolean {
    if (this.config.perTabMaxUsd === null) return false
    return this.getTabSpent(tabId) >= this.config.perTabMaxUsd
  }

  isDailyOverBudget(): boolean {
    if (this.config.dailyMaxUsd === null) return false
    return this.dailySpent >= this.config.dailyMaxUsd
  }

  // ─── Alert threshold ───

  isDailyAlertTriggered(): boolean {
    if (this.config.dailyMaxUsd === null) return false
    return this.dailySpent >= this.config.dailyMaxUsd * this.config.alertThreshold
  }

  isTabAlertTriggered(tabId: string): boolean {
    if (this.config.perTabMaxUsd === null) return false
    return this.getTabSpent(tabId) >= this.config.perTabMaxUsd * this.config.alertThreshold
  }

  // ─── Remaining ───

  getTabRemaining(tabId: string): number | null {
    if (this.config.perTabMaxUsd === null) return null
    return Math.max(0, this.config.perTabMaxUsd - this.getTabSpent(tabId))
  }

  getDailyRemaining(): number | null {
    if (this.config.dailyMaxUsd === null) return null
    return Math.max(0, this.config.dailyMaxUsd - this.dailySpent)
  }

  // ─── CLI budget injection ───

  getCliBudgetForTab(tabId: string): number | null {
    if (this.config.perTabMaxUsd === null) return null
    const remaining = this.config.perTabMaxUsd - this.getTabSpent(tabId)
    return Math.max(0.01, remaining) // minimum $0.01 to avoid 0
  }

  // ─── Status snapshot ───

  getStatus(): BudgetStatus {
    const perTabSpent: Record<string, number> = {}
    for (const [tabId, spent] of this.tabSpent) {
      perTabSpent[tabId] = spent
    }
    return { dailySpentUsd: this.dailySpent, perTabSpent }
  }

  // ─── Reset ───

  resetTab(tabId: string): void {
    const tabAmount = this.tabSpent.get(tabId) || 0
    this.dailySpent = Math.max(0, this.dailySpent - tabAmount)
    this.tabSpent.delete(tabId)
  }

  resetDaily(): void {
    this.tabSpent.clear()
    this.dailySpent = 0
  }
}
