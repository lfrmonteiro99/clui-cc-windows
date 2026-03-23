import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ArrowCounterClockwise } from '@phosphor-icons/react'
import { useTerminalStore } from '../stores/terminalStore'
import { useColors } from '../theme'

const SCROLLBACK_PRESETS = [1000, 5000, 10000, 50000]

export function TerminalSettings() {
  const settingsOpen = useTerminalStore((s) => s.settingsOpen)
  const setSettingsOpen = useTerminalStore((s) => s.setSettingsOpen)
  const scrollbackSize = useTerminalStore((s) => s.scrollbackSize)
  const setScrollbackSize = useTerminalStore((s) => s.setScrollbackSize)
  const bellEnabled = useTerminalStore((s) => s.bellEnabled)
  const setBellEnabled = useTerminalStore((s) => s.setBellEnabled)
  const autoNaming = useTerminalStore((s) => s.autoNaming)
  const setAutoNaming = useTerminalStore((s) => s.setAutoNaming)
  const backgroundOpacity = useTerminalStore((s) => s.backgroundOpacity)
  const setBackgroundOpacity = useTerminalStore((s) => s.setBackgroundOpacity)
  const backgroundBlur = useTerminalStore((s) => s.backgroundBlur)
  const setBackgroundBlur = useTerminalStore((s) => s.setBackgroundBlur)
  const imageProtocolEnabled = useTerminalStore((s) => s.imageProtocolEnabled)
  const setImageProtocolEnabled = useTerminalStore((s) => s.setImageProtocolEnabled)
  const resetSettings = useTerminalStore((s) => s.resetSettings)
  const colors = useColors()

  return (
    <AnimatePresence>
      {settingsOpen && (
        <motion.div
          data-clui-ui
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{ duration: 0.15 }}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: 280,
            zIndex: 30,
            background: colors.popoverBg,
            backdropFilter: 'blur(12px)',
            borderLeft: `1px solid ${colors.popoverBorder}`,
            boxShadow: '-4px 0 12px rgba(0,0,0,0.2)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between"
            style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.containerBorder}` }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
              Terminal Settings
            </span>
            <button
              onClick={() => setSettingsOpen(false)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: colors.textSecondary, padding: 2, display: 'flex' }}
              aria-label="Close settings"
            >
              <X size={16} />
            </button>
          </div>

          {/* Settings body */}
          <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Scrollback buffer */}
            <SettingRow label="Scrollback Buffer" hint="Lines kept in scroll history">
              <select
                value={SCROLLBACK_PRESETS.includes(scrollbackSize) ? scrollbackSize : 'custom'}
                onChange={(e) => {
                  const val = e.target.value
                  if (val === 'custom') return
                  setScrollbackSize(Number(val))
                }}
                style={selectStyle(colors)}
              >
                {SCROLLBACK_PRESETS.map((v) => (
                  <option key={v} value={v}>{v.toLocaleString()} lines</option>
                ))}
              </select>
            </SettingRow>

            {/* Visual bell */}
            <SettingRow label="Visual Bell">
              <Toggle checked={bellEnabled} onChange={setBellEnabled} colors={colors} />
            </SettingRow>

            {/* Auto-naming */}
            <SettingRow label="Auto-name Tabs" hint="Update tab title from shell">
              <Toggle checked={autoNaming} onChange={setAutoNaming} colors={colors} />
            </SettingRow>

            {/* Background opacity */}
            <SettingRow label="Background Opacity" hint={`${Math.round(backgroundOpacity * 100)}%`}>
              <input
                type="range"
                min={0.4}
                max={1}
                step={0.05}
                value={backgroundOpacity}
                onChange={(e) => setBackgroundOpacity(Number(e.target.value))}
                style={{ width: '100%', accentColor: colors.accent }}
              />
            </SettingRow>

            {/* Background blur */}
            <SettingRow label="Background Blur" hint={backgroundBlur > 0 ? `${backgroundBlur}px` : 'Off'}>
              <input
                type="range"
                min={0}
                max={16}
                step={1}
                value={backgroundBlur}
                onChange={(e) => setBackgroundBlur(Number(e.target.value))}
                style={{ width: '100%', accentColor: colors.accent }}
              />
            </SettingRow>

            {/* Image protocol */}
            <SettingRow label="Image Protocol" hint="Sixel/Kitty/iTerm2 (restart needed)">
              <Toggle checked={imageProtocolEnabled} onChange={setImageProtocolEnabled} colors={colors} />
            </SettingRow>
          </div>

          {/* Reset button */}
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${colors.containerBorder}` }}>
            <button
              onClick={resetSettings}
              className="flex items-center gap-1"
              style={{
                background: 'transparent',
                border: `1px solid ${colors.containerBorder}`,
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 11,
                color: colors.textSecondary,
                cursor: 'pointer',
              }}
            >
              <ArrowCounterClockwise size={12} />
              Reset to Defaults
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const colors = useColors()
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 500, color: colors.textPrimary, marginBottom: 4 }}>
        {label}
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: colors.textTertiary, marginBottom: 6 }}>
          {hint}
        </div>
      )}
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, colors }: { checked: boolean; onChange: (v: boolean) => void; colors: ReturnType<typeof useColors> }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 32,
        height: 18,
        borderRadius: 9,
        border: 'none',
        cursor: 'pointer',
        background: checked ? colors.accent : colors.surfaceHover,
        position: 'relative',
        transition: 'background 0.15s',
        padding: 0,
      }}
      role="switch"
      aria-checked={checked}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
        }}
      />
    </button>
  )
}

function selectStyle(colors: ReturnType<typeof useColors>): React.CSSProperties {
  return {
    width: '100%',
    background: colors.surfaceHover,
    color: colors.textPrimary,
    border: `1px solid ${colors.containerBorder}`,
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 12,
    outline: 'none',
  }
}
