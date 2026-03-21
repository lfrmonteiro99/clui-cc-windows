// ─── Cost Analytics: Actionable Optimization Insights ───

import type { CostSummary, CostRecord } from './types'

// ─── Types ───

export interface CostInsight {
  id: string
  severity: 'info' | 'warning' | 'action'
  title: string
  description: string
  savingsEstimateUsd?: number
  action?: { label: string; command: string }
}

export interface InsightContext {
  routerEnabled: boolean
  cacheEnabled: boolean
  dailyBudgetUsd?: number | null
}

// ─── Constants ───

const MAX_INSIGHTS = 5
const HIGH_COST_PER_RUN_THRESHOLD = 1.0  // $1.00 per run is high
const OPUS_SHORT_RUN_THRESHOLD = 0.3     // 30% of Opus runs are short → suggest routing
const SPENDING_INCREASE_THRESHOLD = 1.5  // 50% increase day-over-day

// ─── Model display names ───

const MODEL_NAMES: Record<string, string> = {
  'claude-opus-4-6': 'Opus',
  'claude-sonnet-4-6': 'Sonnet',
  'claude-haiku-4-5-20251001': 'Haiku',
}

function modelLabel(id: string): string {
  return MODEL_NAMES[id] || id
}

// ─── Insight generators ───

function checkModelRouting(
  summary: CostSummary,
  records: CostRecord[],
  ctx: InsightContext,
): CostInsight | null {
  if (ctx.routerEnabled) return null

  // Check if a significant portion of Opus runs are "simple" (few turns, low output)
  const opusRecords = records.filter((r) => r.model === 'claude-opus-4-6')
  if (opusRecords.length < 5) return null

  const shortRuns = opusRecords.filter((r) => r.numTurns <= 3 && r.outputTokens < 500)
  const ratio = shortRuns.length / opusRecords.length

  if (ratio < OPUS_SHORT_RUN_THRESHOLD) return null

  const potentialSavings = shortRuns.reduce((sum, r) => sum + r.costUsd * 0.8, 0)

  return {
    id: 'enable-routing',
    severity: 'action',
    title: 'Enable smart model routing',
    description: `${Math.round(ratio * 100)}% of your Opus runs are short tasks (≤3 turns). Auto-routing these to Haiku/Sonnet could save ~$${potentialSavings.toFixed(2)}.`,
    savingsEstimateUsd: potentialSavings,
    action: { label: 'Enable auto-routing', command: 'toggle-model-router' },
  }
}

function checkSpendingTrend(summary: CostSummary): CostInsight | null {
  const days = summary.byDay
  if (days.length < 3) return null

  // Compare last day to average of previous days
  const lastDay = days[days.length - 1]
  const previousDays = days.slice(0, -1)
  const avgPrevious = previousDays.reduce((sum, d) => sum + d.costUsd, 0) / previousDays.length

  if (avgPrevious === 0) return null
  const ratio = lastDay.costUsd / avgPrevious

  if (ratio < SPENDING_INCREASE_THRESHOLD) return null

  return {
    id: 'spending-trend',
    severity: 'warning',
    title: 'Spending is increasing',
    description: `Today's spend ($${lastDay.costUsd.toFixed(2)}) is ${Math.round((ratio - 1) * 100)}% higher than your recent average ($${avgPrevious.toFixed(2)}/day).`,
  }
}

function checkCacheEnabled(ctx: InsightContext): CostInsight | null {
  if (ctx.cacheEnabled) return null

  return {
    id: 'enable-cache',
    severity: 'info',
    title: 'Response cache is disabled',
    description: 'Studies show 20-40% of prompts are repeats. Enable the response cache to get instant replies for identical questions at $0 cost.',
    action: { label: 'Enable cache', command: 'toggle-cache' },
  }
}

function checkHighCostPerRun(summary: CostSummary): CostInsight | null {
  if (summary.runCount === 0) return null

  const avgCost = summary.totalCostUsd / summary.runCount
  if (avgCost < HIGH_COST_PER_RUN_THRESHOLD) return null

  return {
    id: 'high-cost-per-run',
    severity: 'warning',
    title: 'High average cost per run',
    description: `Your average cost is $${avgCost.toFixed(2)}/run across ${summary.runCount} runs. Consider setting per-tab budget limits or using cheaper models for simple tasks.`,
  }
}

function checkModelDistribution(summary: CostSummary): CostInsight | null {
  const models = Object.entries(summary.byModel)
  if (models.length === 0) return null

  const total = models.reduce((sum, [, v]) => sum + v.runs, 0)
  const parts = models
    .sort((a, b) => b[1].runs - a[1].runs)
    .map(([model, data]) => `${modelLabel(model)} ${Math.round((data.runs / total) * 100)}%`)
    .join(', ')

  return {
    id: 'model-distribution',
    severity: 'info',
    title: 'Model usage breakdown',
    description: `${parts} (${total} total runs, $${summary.totalCostUsd.toFixed(2)} total)`,
  }
}

// ─── Main function ───

export function generateInsights(
  summary: CostSummary,
  records: CostRecord[],
  context: InsightContext,
): CostInsight[] {
  if (summary.runCount === 0 && records.length === 0) return []

  const insights: CostInsight[] = []

  const generators = [
    () => checkModelRouting(summary, records, context),
    () => checkSpendingTrend(summary),
    () => checkHighCostPerRun(summary),
    () => checkCacheEnabled(context),
    () => checkModelDistribution(summary),
  ]

  for (const gen of generators) {
    if (insights.length >= MAX_INSIGHTS) break
    const insight = gen()
    if (insight) insights.push(insight)
  }

  return insights
}
