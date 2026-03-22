/**
 * CrossTabHint — shows when another tab has worked on a similar topic.
 * Helps avoid duplicate work across tabs.
 */

import React from 'react'
import { motion } from 'framer-motion'
import { Binoculars, ArrowRight, X } from '@phosphor-icons/react'
import { useColors } from '../theme'
import type { TabMatch } from '../stores/crossTabStore'

interface Props {
  match: TabMatch
  onNavigate: (tabId: string) => void
  onDismiss: () => void
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export const CrossTabHint = React.memo(function CrossTabHint({ match, onNavigate, onDismiss }: Props) {
  const colors = useColors()

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.15 }}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px]"
      style={{
        background: colors.surfaceSecondary,
        border: `1px solid ${colors.borderSubtle}`,
      }}
    >
      <Binoculars size={14} style={{ color: colors.textMuted }} />
      <span style={{ color: colors.textSecondary }} className="flex-1 truncate">
        Tab &ldquo;{match.title}&rdquo; worked on similar topic {formatTimeAgo(match.lastUpdated)}
      </span>
      <button
        onClick={() => onNavigate(match.tabId)}
        className="flex items-center gap-0.5 hover:underline flex-shrink-0"
        style={{ color: colors.accentPrimary }}
      >
        View <ArrowRight size={10} />
      </button>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
        style={{ color: colors.textMuted }}
      >
        <X size={10} />
      </button>
    </motion.div>
  )
})
