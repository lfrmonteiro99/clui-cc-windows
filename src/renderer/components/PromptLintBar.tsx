import React, { useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { WarningCircle, X } from '@phosphor-icons/react'
import { useColors } from '../theme'
import type { PromptLintWarning } from '../../shared/prompt-linter'

interface PromptLintBarProps {
  warnings: PromptLintWarning[]
}

export function PromptLintBar({ warnings }: PromptLintBarProps) {
  const colors = useColors()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const dismissWarning = useCallback((id: string) => {
    setDismissed((prev) => new Set(prev).add(id))
  }, [])

  const visible = warnings.filter((w) => !dismissed.has(w.id))
  if (visible.length === 0) return null

  return (
    <div
      data-testid="prompt-lint-bar"
      className="flex flex-wrap gap-1 px-1 pb-2"
    >
      <AnimatePresence>
        {visible.map((w) => (
          <motion.div
            key={w.id}
            data-testid={`lint-warning-${w.id}`}
            initial={{ opacity: 0, scale: 0.9, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 4 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1 rounded-full"
            style={{
              padding: '2px 8px 2px 6px',
              fontSize: 11,
              lineHeight: '16px',
              color: colors.textSecondary,
              background: colors.permissionHeaderBg,
              border: `1px solid ${colors.permissionHeaderBorder}`,
            }}
          >
            <WarningCircle
              size={13}
              weight="fill"
              style={{ color: colors.statusPermission, flexShrink: 0 }}
            />
            <span>{w.message}</span>
            <button
              data-testid={`lint-dismiss-${w.id}`}
              onClick={() => dismissWarning(w.id)}
              className="flex items-center justify-center rounded-full transition-colors"
              style={{
                width: 14,
                height: 14,
                marginLeft: 2,
                color: colors.textTertiary,
                flexShrink: 0,
              }}
              title="Dismiss"
            >
              <X size={10} weight="bold" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
