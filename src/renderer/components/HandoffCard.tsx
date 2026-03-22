/**
 * HandoffCard — appears when context utilization exceeds 80%.
 * Offers to generate a compressed context and open a new tab.
 */

import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Lightning, CaretDown, CaretRight, X } from '@phosphor-icons/react'
import { useColors } from '../theme'
import { generateHandoffDocument, formatHandoffAsPrompt } from '../../shared/session-handoff'
import type { Message } from '../../shared/types'

interface Props {
  utilization: number
  messages: Message[]
  onHandoff: (prompt: string) => void
  onDismiss: () => void
}

export const HandoffCard = React.memo(function HandoffCard({
  utilization,
  messages,
  onHandoff,
  onDismiss,
}: Props) {
  const [showPreview, setShowPreview] = useState(false)
  const colors = useColors()

  const handoffDoc = useMemo(
    () => generateHandoffDocument(messages),
    [messages]
  )

  const handoffPrompt = useMemo(
    () => formatHandoffAsPrompt(handoffDoc),
    [handoffDoc]
  )

  const pct = Math.round(utilization * 100)

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="rounded-lg p-3 mb-2"
      style={{
        background: colors.warningBg,
        border: `1px solid ${colors.warningBorder}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px]" style={{ color: colors.warningText }}>
          <Lightning size={14} weight="fill" />
          <span>
            Context is {pct}% full. Start a fresh session with compressed context?
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
          style={{ color: colors.warningText }}
        >
          <X size={12} />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="flex items-center gap-1 text-[11px] hover:underline"
          style={{ color: colors.textSecondary }}
        >
          {showPreview ? <CaretDown size={10} /> : <CaretRight size={10} />}
          Preview handoff
        </button>

        <button
          onClick={() => onHandoff(handoffPrompt)}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
          style={{
            background: colors.accentPrimary,
            color: colors.textOnAccent,
          }}
        >
          <ArrowRight size={12} />
          Continue in new tab
        </button>
      </div>

      <AnimatePresence>
        {showPreview && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <pre
              className="mt-2 p-2 rounded text-[10px] leading-tight overflow-auto max-h-[200px]"
              style={{
                background: colors.surfaceSecondary,
                color: colors.textSecondary,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {handoffPrompt}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
})
