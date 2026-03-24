import type { TokenUsageSnapshot } from '../shared/types'

/**
 * Tracks cumulative token usage per tab across CLI result and message_delta events.
 *
 * Used by ControlPlane to aggregate token counts and relay them to the renderer
 * for display and proactive notifications.
 */
export class TokenTracker {
  private usageByTab = new Map<string, TokenUsageSnapshot>()

  /**
   * Record a token usage event for a tab. Accumulates counts.
   */
  recordUsage(tabId: string, usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }): TokenUsageSnapshot {
    const existing = this.usageByTab.get(tabId)
    const updated: TokenUsageSnapshot = {
      inputTokens: (existing?.inputTokens ?? 0) + usage.inputTokens,
      outputTokens: (existing?.outputTokens ?? 0) + usage.outputTokens,
      totalTokens: (existing?.totalTokens ?? 0) + usage.totalTokens,
      cacheReadTokens: (existing?.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
      cacheWriteTokens: (existing?.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
      lastUpdated: Date.now(),
    }
    this.usageByTab.set(tabId, updated)
    return updated
  }

  /**
   * Get the current token usage snapshot for a tab, or null if no data.
   */
  getTokenUsage(tabId: string): TokenUsageSnapshot | null {
    return this.usageByTab.get(tabId) ?? null
  }

  /**
   * Reset token tracking for a tab (e.g., on session reset).
   */
  resetTab(tabId: string): void {
    this.usageByTab.delete(tabId)
  }

  /**
   * Rough token estimate: ~4 characters per token.
   * Used as fallback when usage data is unavailable.
   */
  static estimateTokens(text: string): number {
    if (!text) return 0
    return Math.ceil(text.length / 4)
  }
}
