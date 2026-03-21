import { describe, it, expect } from 'vitest'
import { generateInsights, type InsightContext } from '../../src/shared/cost-analytics'
import type { CostSummary, CostRecord } from '../../src/shared/types'

function makeRecord(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    timestamp: Date.now(),
    sessionId: 'sess-1',
    model: 'claude-opus-4-6',
    projectPath: '/project',
    costUsd: 0.10,
    durationMs: 5000,
    numTurns: 3,
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ...overrides,
  }
}

function makeSummary(overrides: Partial<CostSummary> = {}): CostSummary {
  return {
    totalCostUsd: 5.0,
    totalInputTokens: 50000,
    totalOutputTokens: 25000,
    totalDurationMs: 300000,
    runCount: 50,
    byModel: {
      'claude-opus-4-6': { costUsd: 4.0, runs: 40 },
      'claude-sonnet-4-6': { costUsd: 0.8, runs: 8 },
      'claude-haiku-4-5-20251001': { costUsd: 0.2, runs: 2 },
    },
    byProject: { '/project': { costUsd: 5.0, runs: 50 } },
    byDay: [
      { date: '2026-03-20', costUsd: 2.0, runs: 20 },
      { date: '2026-03-21', costUsd: 3.0, runs: 30 },
    ],
    ...overrides,
  }
}

describe('generateInsights', () => {
  // ─── Model routing insight ───

  it('suggests model routing when Opus dominates with many short runs', () => {
    const records = Array.from({ length: 20 }, () =>
      makeRecord({ model: 'claude-opus-4-6', numTurns: 2, outputTokens: 200 }),
    )
    const context: InsightContext = { routerEnabled: false, cacheEnabled: true }
    const insights = generateInsights(makeSummary(), records, context)

    const routingInsight = insights.find((i) => i.id === 'enable-routing')
    expect(routingInsight).toBeDefined()
    expect(routingInsight!.severity).toBe('action')
  })

  it('does not suggest routing when already enabled', () => {
    const records = Array.from({ length: 20 }, () =>
      makeRecord({ model: 'claude-opus-4-6', numTurns: 2, outputTokens: 200 }),
    )
    const context: InsightContext = { routerEnabled: true, cacheEnabled: true }
    const insights = generateInsights(makeSummary(), records, context)
    expect(insights.find((i) => i.id === 'enable-routing')).toBeUndefined()
  })

  // ─── Spending trend insight ───

  it('warns when spending is increasing', () => {
    const summary = makeSummary({
      byDay: [
        { date: '2026-03-18', costUsd: 1.0, runs: 10 },
        { date: '2026-03-19', costUsd: 1.2, runs: 12 },
        { date: '2026-03-20', costUsd: 2.0, runs: 20 },
        { date: '2026-03-21', costUsd: 3.5, runs: 35 },
      ],
    })
    const context: InsightContext = { routerEnabled: true, cacheEnabled: true }
    const insights = generateInsights(summary, [], context)

    const trendInsight = insights.find((i) => i.id === 'spending-trend')
    expect(trendInsight).toBeDefined()
    expect(trendInsight!.severity).toBe('warning')
  })

  it('does not warn for stable spending', () => {
    const summary = makeSummary({
      byDay: [
        { date: '2026-03-18', costUsd: 1.0, runs: 10 },
        { date: '2026-03-19', costUsd: 1.0, runs: 10 },
        { date: '2026-03-20', costUsd: 1.0, runs: 10 },
        { date: '2026-03-21', costUsd: 1.0, runs: 10 },
      ],
    })
    const context: InsightContext = { routerEnabled: true, cacheEnabled: true }
    const insights = generateInsights(summary, [], context)
    expect(insights.find((i) => i.id === 'spending-trend')).toBeUndefined()
  })

  // ─── Cache suggestion ───

  it('suggests enabling cache when disabled', () => {
    const context: InsightContext = { routerEnabled: true, cacheEnabled: false }
    const insights = generateInsights(makeSummary(), [], context)

    const cacheInsight = insights.find((i) => i.id === 'enable-cache')
    expect(cacheInsight).toBeDefined()
    expect(cacheInsight!.severity).toBe('info')
  })

  it('does not suggest cache when already enabled', () => {
    const context: InsightContext = { routerEnabled: true, cacheEnabled: true }
    const insights = generateInsights(makeSummary(), [], context)
    expect(insights.find((i) => i.id === 'enable-cache')).toBeUndefined()
  })

  // ─── High cost-per-run ───

  it('warns about high cost-per-run', () => {
    const summary = makeSummary({
      totalCostUsd: 50.0,
      runCount: 10, // $5 per run average
    })
    const context: InsightContext = { routerEnabled: true, cacheEnabled: true }
    const insights = generateInsights(summary, [], context)

    const costInsight = insights.find((i) => i.id === 'high-cost-per-run')
    expect(costInsight).toBeDefined()
  })

  it('does not warn when cost-per-run is reasonable', () => {
    const summary = makeSummary({
      totalCostUsd: 1.0,
      runCount: 50, // $0.02 per run
    })
    const context: InsightContext = { routerEnabled: true, cacheEnabled: true }
    const insights = generateInsights(summary, [], context)
    expect(insights.find((i) => i.id === 'high-cost-per-run')).toBeUndefined()
  })

  // ─── Model distribution insight ───

  it('shows model distribution info', () => {
    const summary = makeSummary()
    const context: InsightContext = { routerEnabled: true, cacheEnabled: true }
    const insights = generateInsights(summary, [], context)

    const distInsight = insights.find((i) => i.id === 'model-distribution')
    expect(distInsight).toBeDefined()
    expect(distInsight!.severity).toBe('info')
    expect(distInsight!.description).toContain('Opus')
  })

  // ─── Edge cases ───

  it('returns empty insights for empty data', () => {
    const emptySummary = makeSummary({
      totalCostUsd: 0,
      runCount: 0,
      byModel: {},
      byDay: [],
    })
    const context: InsightContext = { routerEnabled: true, cacheEnabled: true }
    const insights = generateInsights(emptySummary, [], context)
    expect(insights).toEqual([])
  })

  it('returns at most 5 insights', () => {
    const records = Array.from({ length: 50 }, () =>
      makeRecord({ model: 'claude-opus-4-6', numTurns: 1, outputTokens: 50 }),
    )
    const summary = makeSummary({
      totalCostUsd: 100.0,
      runCount: 10,
      byDay: [
        { date: '2026-03-18', costUsd: 5.0, runs: 5 },
        { date: '2026-03-19', costUsd: 10.0, runs: 5 },
        { date: '2026-03-20', costUsd: 20.0, runs: 5 },
        { date: '2026-03-21', costUsd: 65.0, runs: 5 },
      ],
    })
    const context: InsightContext = { routerEnabled: false, cacheEnabled: false }
    const insights = generateInsights(summary, records, context)
    expect(insights.length).toBeLessThanOrEqual(5)
  })

  // ─── Return shape ───

  it('insights have correct shape', () => {
    const summary = makeSummary()
    const context: InsightContext = { routerEnabled: false, cacheEnabled: false }
    const insights = generateInsights(summary, [], context)

    for (const insight of insights) {
      expect(insight).toHaveProperty('id')
      expect(insight).toHaveProperty('severity')
      expect(insight).toHaveProperty('title')
      expect(insight).toHaveProperty('description')
      expect(['info', 'warning', 'action']).toContain(insight.severity)
    }
  })
})
