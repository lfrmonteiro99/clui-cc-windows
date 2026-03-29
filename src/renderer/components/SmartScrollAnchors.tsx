import React, { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowDown, Code } from '@phosphor-icons/react'
import { useColors } from '../theme'
import type { Message } from '../../shared/types'

const SCROLL_THRESHOLD = 300

interface SmartScrollAnchorsProps {
  messages: Message[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  distanceFromBottom: number
}

/** Find the last assistant message that contains a fenced code block. */
export function findLastCodeMessage(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant' && msg.content.includes('```')) {
      return msg.id
    }
  }
  return null
}

export const SmartScrollAnchors = React.memo(function SmartScrollAnchors({
  messages,
  scrollRef,
  distanceFromBottom,
}: SmartScrollAnchorsProps) {
  const colors = useColors()
  const visible = distanceFromBottom > SCROLL_THRESHOLD

  const lastCodeMessageId = useMemo(() => findLastCodeMessage(messages), [messages])

  const handleJumpToCode = () => {
    if (!lastCodeMessageId || !scrollRef.current) return
    const el = scrollRef.current.querySelector(`[data-message-id="${lastCodeMessageId}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  const handleJumpToBottom = () => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          data-testid="smart-scroll-anchors"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.15 }}
          className="absolute right-3 flex flex-col gap-1.5 z-10"
          style={{ bottom: 42 }}
        >
          {lastCodeMessageId && (
            <button
              data-testid="jump-to-code"
              onClick={handleJumpToCode}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] cursor-pointer transition-colors"
              style={{
                background: colors.surfacePrimary,
                color: colors.textSecondary,
                border: `1px solid ${colors.containerBorder}`,
                boxShadow: colors.cardShadow,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = colors.surfaceSecondary }}
              onMouseLeave={(e) => { e.currentTarget.style.background = colors.surfacePrimary }}
              title="Jump to latest code block"
            >
              <Code size={12} weight="bold" />
              <span>Jump to code</span>
            </button>
          )}

          <button
            data-testid="jump-to-bottom-anchor"
            onClick={handleJumpToBottom}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] cursor-pointer transition-colors"
            style={{
              background: colors.surfacePrimary,
              color: colors.textSecondary,
              border: `1px solid ${colors.containerBorder}`,
              boxShadow: colors.cardShadow,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = colors.surfaceSecondary }}
            onMouseLeave={(e) => { e.currentTarget.style.background = colors.surfacePrimary }}
            title="Jump to bottom"
          >
            <ArrowDown size={12} weight="bold" />
            <span>Jump to bottom</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
