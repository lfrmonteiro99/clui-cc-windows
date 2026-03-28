import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ListBullets, CaretRight } from '@phosphor-icons/react'
import { useColors } from '../theme'
import { parseOutline, detectStepProgress } from '../../shared/outline-parser'
import type { OutlineEntry, StepProgress } from '../../shared/outline-parser'

const MIN_ENTRIES_TO_SHOW = 3
const AUTO_HIDE_DELAY_MS = 3000

interface ResponseOutlineProps {
  /** The markdown content being streamed */
  content: string
  /** Whether the response is currently streaming */
  isStreaming: boolean
  /** Callback to scroll to a character offset in the message */
  onScrollToOffset: (offset: number) => void
}

export const ResponseOutline = React.memo(function ResponseOutline({
  content,
  isStreaming,
  onScrollToOffset,
}: ResponseOutlineProps) {
  const colors = useColors()
  const [collapsed, setCollapsed] = useState(false)
  const [visible, setVisible] = useState(true)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const entries: OutlineEntry[] = useMemo(() => parseOutline(content), [content])
  const stepProgress: StepProgress | null = useMemo(() => detectStepProgress(content), [content])

  // Auto-hide after streaming completes
  useEffect(() => {
    if (!isStreaming && entries.length >= MIN_ENTRIES_TO_SHOW) {
      hideTimerRef.current = setTimeout(() => {
        setVisible(false)
      }, AUTO_HIDE_DELAY_MS)
    } else if (isStreaming) {
      // Reset visibility when streaming resumes
      setVisible(true)
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }
  }, [isStreaming, entries.length])

  const handleEntryClick = useCallback(
    (offset: number) => {
      onScrollToOffset(offset)
    },
    [onScrollToOffset],
  )

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  // Don't render if too few entries or hidden
  if (entries.length < MIN_ENTRIES_TO_SHOW || !visible) {
    return null
  }

  return (
    <AnimatePresence>
      <motion.div
        data-testid="response-outline"
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 12 }}
        transition={{ duration: 0.2 }}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 5,
          minWidth: 140,
          maxWidth: 200,
          background: colors.containerBg,
          opacity: 0.92,
          border: `1px solid ${colors.containerBorder}`,
          borderRadius: 10,
          boxShadow: colors.cardShadow,
          overflow: 'hidden',
          pointerEvents: 'auto',
        }}
      >
        {/* Header */}
        <button
          data-testid="outline-header"
          onClick={toggleCollapsed}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            padding: '6px 10px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: colors.textSecondary,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          <ListBullets size={13} weight="bold" />
          <span style={{ flex: 1, textAlign: 'left' }}>Outline</span>
          <motion.span
            animate={{ rotate: collapsed ? 0 : 90 }}
            transition={{ duration: 0.15 }}
            style={{ display: 'flex', alignItems: 'center' }}
          >
            <CaretRight size={10} weight="bold" />
          </motion.span>
        </button>

        {/* Entry list */}
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              data-testid="outline-entries"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{ padding: '0 6px 6px' }}>
                {entries.map((entry, idx) => (
                  <OutlineEntryRow
                    key={`${entry.offset}-${idx}`}
                    entry={entry}
                    colors={colors}
                    onClick={handleEntryClick}
                  />
                ))}

                {/* Step progress */}
                {stepProgress && (
                  <div
                    data-testid="outline-step-progress"
                    style={{
                      marginTop: 4,
                      padding: '3px 8px',
                      fontSize: 10,
                      color: colors.textTertiary,
                      borderTop: `1px solid ${colors.containerBorder}`,
                    }}
                  >
                    Step {stepProgress.current} of ~{stepProgress.estimated}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  )
})

// ─── Single entry row ───

interface OutlineEntryRowProps {
  entry: OutlineEntry
  colors: ReturnType<typeof useColors>
  onClick: (offset: number) => void
}

const OutlineEntryRow = React.memo(function OutlineEntryRow({
  entry,
  colors,
  onClick,
}: OutlineEntryRowProps) {
  const paddingLeft = 8 + (entry.level - 1) * 10

  return (
    <button
      data-testid="outline-entry"
      onClick={() => onClick(entry.offset)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        width: '100%',
        padding: `2px 6px 2px ${paddingLeft}px`,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: entry.isActive ? colors.accent : colors.textSecondary,
        fontSize: 11,
        textAlign: 'left',
        borderRadius: 4,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
      title={entry.text}
    >
      {/* Status dot */}
      <span
        data-testid={entry.isActive ? 'outline-dot-active' : 'outline-dot'}
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          flexShrink: 0,
          background: entry.isActive ? colors.accent : colors.textTertiary,
          animation: entry.isActive ? 'pulse 1.5s ease-in-out infinite' : undefined,
        }}
      />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {entry.text}
      </span>
    </button>
  )
})
