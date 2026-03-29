import React, { useEffect } from 'react'
import { Brain, Info } from '@phosphor-icons/react'
import { useColors } from '../theme'
import { useSessionDigestStore } from '../stores/sessionDigestStore'

function RowToggle({
  checked,
  onChange,
  colors,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  colors: ReturnType<typeof useColors>
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className="relative w-9 h-5 rounded-full transition-colors"
      style={{
        background: checked ? colors.accent : colors.surfaceSecondary,
        border: `1px solid ${checked ? colors.accent : colors.containerBorder}`,
      }}
    >
      <span
        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-all"
        style={{
          left: checked ? 18 : 2,
          background: '#fff',
        }}
      />
    </button>
  )
}

export function SessionDigestSettings() {
  const colors = useColors()
  const enabled = useSessionDigestStore((s) => s.enabled)
  const stats = useSessionDigestStore((s) => s.stats)
  const toggleEnabled = useSessionDigestStore((s) => s.toggleEnabled)
  const refreshStats = useSessionDigestStore((s) => s.refreshStats)
  const loadSettings = useSessionDigestStore((s) => s.loadSettings)

  useEffect(() => {
    loadSettings()
    refreshStats()
  }, [loadSettings, refreshStats])

  const formatCost = (usd: number) => {
    if (usd < 0.01) return '<$0.01'
    return `$${usd.toFixed(2)}`
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Brain size={14} style={{ color: colors.textTertiary }} />
          <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
            Session digests
          </div>
        </div>
        <RowToggle
          checked={enabled}
          onChange={() => toggleEnabled()}
          colors={colors}
          label="Toggle cross-session context digests"
        />
      </div>
      <div
        className="flex items-start gap-1.5 mt-1.5 pl-5"
        style={{ color: colors.textTertiary }}
      >
        <Info size={11} className="mt-0.5 flex-shrink-0" />
        <div className="text-[10px] leading-tight">
          Uses Haiku 4.5 (low effort). Avg. extra cost: ~$0.01-0.03/session
        </div>
      </div>
      {enabled && stats && (
        <div className="mt-1.5 pl-5 text-[10px] leading-tight" style={{ color: colors.textTertiary }}>
          {stats.totalDigests} digests total ({formatCost(stats.totalCostUsd)})
          {' / '}
          {stats.monthlyDigests} this month ({formatCost(stats.monthlyCostUsd)})
        </div>
      )}
    </div>
  )
}
