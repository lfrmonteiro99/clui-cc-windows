import React, { useCallback } from 'react'
import { motion } from 'framer-motion'
import { Lightbulb, X } from '@phosphor-icons/react'
import { useColors } from '../theme'
import { useSessionStore } from '../stores/sessionStore'
import type { Message } from '../../shared/types'

interface CompanionMessageProps {
  message: Message
}

export const CompanionMessage = React.memo(function CompanionMessage({ message }: CompanionMessageProps) {
  const colors = useColors()

  const dismiss = useCallback(() => {
    useSessionStore.getState().dismissCompanionMessage(message.id)
  }, [message.id])

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="py-0.5 text-center"
    >
      <div
        data-testid="companion-message"
        className="text-[11px] leading-[1.5] px-2.5 py-1 rounded-lg inline-flex items-center gap-1.5 group relative"
        style={{
          background: colors.accentSoft,
          color: colors.textSecondary,
          fontStyle: 'italic',
        }}
      >
        <Lightbulb weight="fill" size={12} className="flex-shrink-0" style={{ color: colors.textSecondary }} />
        <span>{message.content}</span>
        <button
          type="button"
          onClick={dismiss}
          className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 flex-shrink-0 rounded hover:bg-black/10"
          aria-label="Dismiss companion message"
          style={{ color: colors.textTertiary }}
        >
          <X size={10} />
        </button>
      </div>
    </motion.div>
  )
})
