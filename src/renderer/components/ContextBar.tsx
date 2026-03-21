import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Lightning, ArrowsClockwise, Question } from '@phosphor-icons/react'
import { useColors } from '../theme'
import { useTokenBudgetStore, type ThresholdLevel } from '../stores/tokenBudgetStore'

// ─── Helpers ───

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function thresholdColor(level: ThresholdLevel, colors: ReturnType<typeof useColors>): string {
  switch (level) {
    case 'critical':
      return colors.statusError
    case 'warning':
      return colors.statusPermission
    default:
      return colors.accent
  }
}

function thresholdBgColor(level: ThresholdLevel, colors: ReturnType<typeof useColors>): string {
  switch (level) {
    case 'critical':
      return colors.statusErrorBg
    case 'warning':
      return colors.statusRunningBg
    default:
      return colors.accentLight
  }
}

// ─── Category descriptions (human-friendly) ───

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  Input: 'What you send — your prompts, files, and context that Claude reads',
  Output: 'What Claude replies — the text and code Claude generates for you',
  'Cache Read': 'Reused from previous turns — context Claude already knows (saves cost)',
  'Cache Write': 'New context being saved — so Claude can reuse it next turn',
}

// ─── Component ───

interface ContextBarProps {
  tabId: string
}

export function ContextBar({ tabId }: ContextBarProps) {
  const colors = useColors()
  const budget = useTokenBudgetStore((s) => s.budgets[tabId])
  const maxTokens = useTokenBudgetStore((s) => s.maxContextTokens)
  const [legendOpen, setLegendOpen] = useState(false)

  if (!budget) return null

  const utilization = Math.min(budget.inputTokens / maxTokens, 1.0)
  const utilizationPct = Math.round(utilization * 100)
  const headroom = Math.max(maxTokens - budget.inputTokens, 0)

  const level: ThresholdLevel =
    utilization >= 0.85 ? 'critical' : utilization >= 0.7 ? 'warning' : 'normal'

  const totalTokens = budget.inputTokens + budget.outputTokens + budget.cacheReadTokens + budget.cacheCreationTokens

  // Build segments for the bar
  const categories = [
    { label: 'Input', tokens: budget.inputTokens, color: '#d97757' },
    { label: 'Output', tokens: budget.outputTokens, color: '#7aac8c' },
    { label: 'Cache Read', tokens: budget.cacheReadTokens, color: '#6b9bd2' },
    { label: 'Cache Write', tokens: budget.cacheCreationTokens, color: '#c4a06e' },
  ].filter((c) => c.tokens > 0)

  const barColor = thresholdColor(level, colors)
  const barBg = thresholdBgColor(level, colors)

  return (
    <div
      data-testid="context-bar"
      data-threshold={level}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        fontSize: 11,
        color: colors.textSecondary,
        borderBottom: `1px solid ${colors.containerBorder}`,
        background: barBg,
      }}
    >
      {/* Segment bar */}
      <div
        style={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          background: colors.surfacePrimary,
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        {categories.map((cat) => {
          const width = totalTokens > 0 ? (cat.tokens / maxTokens) * 100 : 0
          return (
            <motion.div
              key={cat.label}
              data-testid="context-bar-segment"
              initial={{ width: 0 }}
              animate={{ width: `${width}%` }}
              transition={{ duration: 0.3 }}
              style={{
                height: '100%',
                background: cat.color,
              }}
              title={`${cat.label}: ${formatTokenCount(cat.tokens)}`}
            />
          )
        })}
      </div>

      {/* Utilization % */}
      <span style={{ fontWeight: 600, color: barColor, minWidth: 28, textAlign: 'right' }}>
        {utilizationPct}%
      </span>

      {/* Stats */}
      <span style={{ color: colors.textTertiary, whiteSpace: 'nowrap' }}>
        {formatTokenCount(budget.inputTokens)} used · {formatTokenCount(headroom)} remaining · {budget.turns} turn{budget.turns !== 1 ? 's' : ''}
      </span>

      {/* Threshold actions */}
      {level === 'warning' && (
        <button
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '2px 8px',
            fontSize: 10,
            fontWeight: 600,
            border: `1px solid ${barColor}`,
            borderRadius: 4,
            background: 'transparent',
            color: barColor,
            cursor: 'pointer',
          }}
        >
          <ArrowsClockwise size={12} />
          Summarize
        </button>
      )}
      {level === 'critical' && (
        <button
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '2px 8px',
            fontSize: 10,
            fontWeight: 600,
            border: `1px solid ${barColor}`,
            borderRadius: 4,
            background: 'transparent',
            color: barColor,
            cursor: 'pointer',
          }}
        >
          <Lightning size={12} />
          Start fresh
        </button>
      )}

      {/* Legend toggle */}
      <button
        data-testid="context-bar-legend-toggle"
        onClick={() => setLegendOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: `1px solid ${colors.containerBorder}`,
          background: legendOpen ? colors.surfaceSecondary : 'transparent',
          color: colors.textTertiary,
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
        }}
        title="What does this mean?"
      >
        <Question size={11} weight="bold" />
      </button>

      {/* Legend panel */}
      <AnimatePresence>
        {legendOpen && (
          <motion.div
            data-testid="context-bar-legend"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '100%',
              background: colors.popoverBg,
              border: `1px solid ${colors.popoverBorder}`,
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 11,
              zIndex: 10,
              boxShadow: colors.popoverShadow,
            }}
          >
            <div style={{ color: colors.textSecondary, fontWeight: 600, marginBottom: 8 }}>
              This bar shows Claude&apos;s memory capacity for this conversation
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {categories.map((cat) => (
                <div key={cat.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: cat.color,
                      marginTop: 2,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, color: colors.textPrimary }}>
                      {cat.label}
                    </span>
                    <span style={{ color: colors.textTertiary, marginLeft: 6 }}>
                      {formatTokenCount(cat.tokens)}
                    </span>
                    <div style={{ color: colors.textTertiary, marginTop: 1 }}>
                      {CATEGORY_DESCRIPTIONS[cat.label]}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
