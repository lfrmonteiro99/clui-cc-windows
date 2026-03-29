import React, { useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Sparkle, MagnifyingGlass, Tabs, Lightning } from '@phosphor-icons/react'
import { useColors } from '../theme'
import { useOnboardingStore } from '../stores/onboardingStore'

interface OnboardingWelcomeProps {
  onTryAsking?: (text: string) => void
}

interface FeatureSpotlight {
  icon: React.ElementType
  title: string
  description: string
  shortcutMac: string
  shortcutWin: string
}

const FEATURES: FeatureSpotlight[] = [
  {
    icon: MagnifyingGlass,
    title: 'Command Palette',
    description: 'Search commands, switch models, manage tabs',
    shortcutMac: 'Cmd+K',
    shortcutWin: 'Ctrl+K',
  },
  {
    icon: Tabs,
    title: 'Multi-Tab Sessions',
    description: 'Run multiple Claude sessions in parallel',
    shortcutMac: 'Cmd+T',
    shortcutWin: 'Ctrl+T',
  },
  {
    icon: Lightning,
    title: 'Quick Toggle',
    description: 'Show/hide CLUI instantly from anywhere',
    shortcutMac: 'Alt+Space',
    shortcutWin: 'Ctrl+Space',
  },
]

function isMacPlatform(): boolean {
  if (typeof navigator !== 'undefined') {
    return navigator.platform.toLowerCase().includes('mac')
  }
  return false
}

export function OnboardingWelcome({ onTryAsking }: OnboardingWelcomeProps) {
  const colors = useColors()
  const setCompleted = useOnboardingStore((s) => s.setCompleted)
  const isMac = useMemo(() => isMacPlatform(), [])

  const handleGetStarted = useCallback(() => {
    setCompleted()
  }, [setCompleted])

  const handleTryAsking = useCallback(() => {
    setCompleted()
    onTryAsking?.('Explain this codebase')
  }, [setCompleted, onTryAsking])

  return (
    <motion.div
      data-testid="onboarding-welcome"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="flex flex-col items-center justify-center py-6 px-4"
      style={{ minHeight: 120 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <Sparkle size={20} weight="fill" style={{ color: colors.accent }} />
        <span className="text-[15px] font-semibold" style={{ color: colors.textPrimary }}>
          Welcome to CLUI
        </span>
      </div>

      <span className="text-[12px] mb-4" style={{ color: colors.textTertiary }}>
        Your Claude Code companion
      </span>

      {/* Feature spotlights */}
      <div className="flex flex-col gap-2 w-full max-w-[340px] mb-4">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            data-testid="feature-spotlight"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5"
            style={{
              background: colors.surfacePrimary,
              border: `1px solid ${colors.containerBorder}`,
            }}
          >
            <feature.icon
              size={18}
              weight="duotone"
              style={{ color: colors.accent, flexShrink: 0 }}
            />
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                {feature.title}
              </span>
              <span className="text-[11px]" style={{ color: colors.textTertiary }}>
                {feature.description}
              </span>
            </div>
            <span
              className="text-[10px] font-mono rounded px-1.5 py-0.5 shrink-0"
              style={{
                background: colors.accentLight,
                color: colors.accent,
                border: `1px solid ${colors.accentBorder}`,
              }}
            >
              {isMac ? feature.shortcutMac : feature.shortcutWin}
            </span>
          </div>
        ))}
      </div>

      {/* Get Started button */}
      <motion.button
        data-testid="onboarding-get-started"
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={handleGetStarted}
        className="text-[13px] font-medium rounded-lg px-6 py-2 mb-3 cursor-pointer"
        style={{
          background: colors.accent,
          color: colors.textOnAccent,
        }}
      >
        Get Started
      </motion.button>

      {/* Try asking CTA */}
      <motion.button
        data-testid="onboarding-try-asking"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={handleTryAsking}
        className="text-[11px] cursor-pointer bg-transparent border-0 p-0"
        style={{ color: colors.textTertiary }}
      >
        Try asking: &quot;Explain this codebase&quot;
      </motion.button>
    </motion.div>
  )
}
