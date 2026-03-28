import React, { useEffect } from 'react'
import { Lightbulb, Info } from '@phosphor-icons/react'
import { useColors } from '../theme'
import { useCompanionStore } from '../stores/companionStore'

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

export function CompanionSettings() {
  const colors = useColors()
  const enabled = useCompanionStore((s) => s.enabled)
  const toggleEnabled = useCompanionStore((s) => s.toggleEnabled)
  const loadSettings = useCompanionStore((s) => s.loadSettings)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Lightbulb size={14} style={{ color: colors.textTertiary }} />
          <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
            Companion narrator
          </div>
        </div>
        <RowToggle
          checked={enabled}
          onChange={() => toggleEnabled()}
          colors={colors}
          label="Toggle companion narrator"
        />
      </div>
      <div
        className="flex items-start gap-1.5 mt-1.5 pl-5"
        style={{ color: colors.textTertiary }}
      >
        <Info size={11} className="mt-0.5 flex-shrink-0" />
        <div className="text-[10px] leading-tight">
          Shows brief commentary during idle gaps while the agent works. Uses Haiku 4.5 (low effort).
        </div>
      </div>
    </div>
  )
}
