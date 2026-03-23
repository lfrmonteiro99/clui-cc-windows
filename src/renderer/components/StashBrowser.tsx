import React, { useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  SpinnerGap,
  GitBranch,
  CaretRight,
  CaretDown,
  Package,
} from '@phosphor-icons/react'
import { useColors } from '../theme'
import { useSessionStore } from '../stores/sessionStore'
import { useSandboxStore } from '../stores/sandboxStore'
import type { StashEntry } from '../../shared/sandbox-types'

const TRANSITION = { duration: 0.2, ease: [0.4, 0, 0.1, 1] as const }

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function StashBrowser() {
  const colors = useColors()

  const stashBrowserOpen = useSandboxStore((s) => s.stashBrowserOpen)
  const setStashBrowserOpen = useSandboxStore((s) => s.setStashBrowserOpen)
  const stashList = useSandboxStore((s) => s.stashList)
  const stashLoading = useSandboxStore((s) => s.stashLoading)
  const selectedStashIndex = useSandboxStore((s) => s.selectedStashIndex)
  const stashDiff = useSandboxStore((s) => s.stashDiff)
  const loadStashes = useSandboxStore((s) => s.loadStashes)
  const loadStashDiff = useSandboxStore((s) => s.loadStashDiff)

  const workingDirectory = useSessionStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.workingDirectory ?? '',
  )

  // Load stash list on mount
  useEffect(() => {
    if (stashBrowserOpen && workingDirectory) {
      void loadStashes(workingDirectory)
    }
  }, [stashBrowserOpen, workingDirectory, loadStashes])

  const handleClose = useCallback(() => {
    setStashBrowserOpen(false)
  }, [setStashBrowserOpen])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        handleClose()
      }
    },
    [handleClose],
  )

  const handleEntryClick = useCallback(
    (entry: StashEntry) => {
      if (selectedStashIndex === entry.index) {
        // Collapse
        useSandboxStore.setState({ selectedStashIndex: null, stashDiff: null })
      } else {
        void loadStashDiff(workingDirectory, entry.index)
      }
    },
    [selectedStashIndex, workingDirectory, loadStashDiff],
  )

  return (
    <AnimatePresence>
      {stashBrowserOpen && (
        <motion.div
          data-clui-ui
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={handleBackdropClick}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.30)',
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={TRANSITION}
            style={{
              width: '100%',
              maxWidth: 640,
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 16,
              background: colors.containerBg,
              border: `1px solid ${colors.containerBorder}`,
              boxShadow: colors.cardShadow,
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 18px',
                borderBottom: `1px solid ${colors.containerBorder}`,
                flexShrink: 0,
              }}
            >
              <Package size={16} style={{ color: colors.accent, flexShrink: 0 }} />
              <span
                style={{
                  color: colors.textPrimary,
                  fontSize: 13,
                  fontWeight: 600,
                  flex: 1,
                }}
              >
                Git Stashes
              </span>
              {!stashLoading && (
                <span
                  style={{
                    fontSize: 10,
                    color: colors.textTertiary,
                    background: colors.surfacePrimary,
                    padding: '2px 8px',
                    borderRadius: 9999,
                    fontWeight: 500,
                  }}
                >
                  {stashList.length}
                </span>
              )}
              <button
                onClick={handleClose}
                title="Close"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  border: 'none',
                  background: 'transparent',
                  color: colors.textTertiary,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = colors.surfaceHover
                  e.currentTarget.style.color = colors.textSecondary
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = colors.textTertiary
                }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '8px 0',
              }}
            >
              {stashLoading ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 40,
                  }}
                >
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  >
                    <SpinnerGap size={24} style={{ color: colors.textTertiary }} />
                  </motion.div>
                </div>
              ) : stashList.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                  <Package size={28} style={{ color: colors.textTertiary, marginBottom: 8 }} />
                  <div style={{ color: colors.textTertiary, fontSize: 12 }}>
                    No stashes found
                  </div>
                  <div style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
                    Use git stash to save uncommitted changes
                  </div>
                </div>
              ) : (
                stashList.map((entry) => (
                  <StashRow
                    key={entry.index}
                    entry={entry}
                    isExpanded={selectedStashIndex === entry.index}
                    diff={selectedStashIndex === entry.index ? stashDiff : null}
                    onClick={() => handleEntryClick(entry)}
                    colors={colors}
                  />
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Stash Row ───

interface StashRowProps {
  entry: StashEntry
  isExpanded: boolean
  diff: string | null
  onClick: () => void
  colors: ReturnType<typeof useColors>
}

function StashRow({ entry, isExpanded, diff, onClick, colors }: StashRowProps) {
  return (
    <div>
      <button
        onClick={onClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '8px 18px',
          background: isExpanded ? colors.surfaceHover : 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: colors.textPrimary,
          fontSize: 12,
          fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => {
          if (!isExpanded) e.currentTarget.style.background = colors.surfaceHover
        }}
        onMouseLeave={(e) => {
          if (!isExpanded) e.currentTarget.style.background = 'transparent'
        }}
      >
        {isExpanded ? (
          <CaretDown size={10} style={{ color: colors.textTertiary, flexShrink: 0 }} />
        ) : (
          <CaretRight size={10} style={{ color: colors.textTertiary, flexShrink: 0 }} />
        )}

        <GitBranch size={13} style={{ color: colors.accent, flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: colors.textPrimary,
              fontSize: 12,
            }}
          >
            {entry.message || `stash@{${entry.index}}`}
          </div>
          <div
            style={{
              fontSize: 10,
              color: colors.textTertiary,
              marginTop: 2,
            }}
          >
            {timeAgo(entry.timestamp)}
            {entry.branch && (
              <span style={{ color: colors.textMuted }}> on {entry.branch}</span>
            )}
          </div>
        </div>

        <span
          style={{
            fontSize: 10,
            color: colors.textTertiary,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {entry.fileCount} file{entry.fileCount !== 1 ? 's' : ''}
        </span>
      </button>

      {/* Expanded diff */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                margin: '0 14px 8px',
                borderRadius: 8,
                border: `1px solid ${colors.containerBorder}`,
                background: colors.codeBg,
                overflow: 'hidden',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {diff === null ? (
                <div
                  style={{
                    padding: 16,
                    textAlign: 'center',
                  }}
                >
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    style={{ display: 'inline-block' }}
                  >
                    <SpinnerGap size={16} style={{ color: colors.textTertiary }} />
                  </motion.div>
                </div>
              ) : diff.length === 0 ? (
                <div
                  style={{
                    padding: 12,
                    color: colors.textTertiary,
                    fontSize: 11,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                  }}
                >
                  (empty diff)
                </div>
              ) : (
                <pre
                  style={{
                    margin: 0,
                    padding: '8px 10px',
                    fontSize: 11,
                    lineHeight: '16px',
                    fontFamily:
                      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                    color: colors.textSecondary,
                    whiteSpace: 'pre',
                    overflowX: 'auto',
                  }}
                >
                  {diff}
                </pre>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
