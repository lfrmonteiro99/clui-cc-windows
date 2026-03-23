/**
 * SandboxRunSummary — elevated modal panel shown after a sandboxed run completes.
 * Displays diff stats (insertions, deletions, files) and merge/revert action buttons.
 */

import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check,
  X,
  CaretDown,
  CaretRight,
  GitMerge,
  ArrowClockwise,
  SpinnerGap,
} from '@phosphor-icons/react'
import { useColors } from '../theme'
import { useSandboxStore } from '../stores/sandboxStore'
import { useSessionStore } from '../stores/sessionStore'
import { useNotificationStore } from '../stores/notificationStore'
import type { MergeResult } from '../../shared/sandbox-types'

// ─── Status color for file status letter ───

function statusColor(
  status: 'M' | 'A' | 'D' | 'R',
  colors: ReturnType<typeof useColors>,
): string {
  switch (status) {
    case 'A':
      return colors.diffAddedBorder
    case 'D':
      return colors.diffRemovedBorder
    case 'M':
      return colors.accent
    case 'R':
      return colors.textTertiary
    default:
      return colors.textSecondary
  }
}

// ─── Component ───

export const SandboxRunSummary = React.memo(function SandboxRunSummary() {
  const colors = useColors()
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const pendingDiff = useSandboxStore((s) => activeTabId ? s.tabStates.get(activeTabId)?.pendingDiff ?? null : null)
  const mergeStatus = useSandboxStore((s) => activeTabId ? s.tabStates.get(activeTabId)?.mergeStatus ?? 'idle' : 'idle')
  const wt = useSandboxStore((s) => activeTabId ? s.tabStates.get(activeTabId)?.activeWorktree ?? null : null)
  const setMergeStatus = useSandboxStore((s) => s.setMergeStatus)
  const addToast = useNotificationStore((s) => s.addToast)

  const [filesExpanded, setFilesExpanded] = useState(false)
  const [merging, setMerging] = useState(false)
  const [reverting, setReverting] = useState(false)

  // Visibility: only show when there is a pending diff AND merge is still pending
  const visible = pendingDiff !== null && mergeStatus === 'pending'

  // ─── Merge handler ───

  const handleMerge = useCallback(async () => {
    if (!wt || !pendingDiff) return
    setMerging(true)
    try {
      // Compute repoRoot by stripping .clui-sandboxes/... from the worktree path
      const sandboxSegment = '.clui-sandboxes'
      const idx = wt.path.indexOf(sandboxSegment)
      const repoRoot = idx !== -1
        ? wt.path.substring(0, idx).replace(/[\\/]+$/, '')
        : wt.path

      const result: MergeResult = await window.clui.sandboxMerge(
        repoRoot,
        wt.branch,
        wt.baseBranch,
      )

      if (result.ok) {
        setMergeStatus(activeTabId, 'merged')
        addToast({
          type: 'success',
          title: 'Sandbox merged',
          message: `${result.merged.length} file${result.merged.length !== 1 ? 's' : ''} merged to ${wt.baseBranch}`,
        })
      } else {
        setMergeStatus(activeTabId, 'conflict')
        addToast({
          type: 'error',
          title: 'Merge conflicts',
          message: `${result.conflicted.length} conflict${result.conflicted.length !== 1 ? 's' : ''} detected — resolve manually`,
        })
      }
    } catch {
      setMergeStatus(activeTabId, 'conflict')
      addToast({
        type: 'error',
        title: 'Merge failed',
        message: 'An unexpected error occurred during merge',
      })
    } finally {
      setMerging(false)
    }
  }, [wt, pendingDiff, activeTabId, setMergeStatus, addToast])

  // ─── Revert handler ───

  const handleRevert = useCallback(async () => {
    if (!wt) return
    setReverting(true)
    try {
      await window.clui.sandboxRevert(wt.path, wt.baseBranch)
      setMergeStatus(activeTabId, 'reverted')
      addToast({
        type: 'info',
        title: 'Sandbox discarded',
        message: 'Worktree changes have been reverted',
      })
    } catch {
      addToast({
        type: 'error',
        title: 'Revert failed',
        message: 'An unexpected error occurred during revert',
      })
    } finally {
      setReverting(false)
    }
  }, [wt, activeTabId, setMergeStatus, addToast])

  // ─── Close (dismiss without action — revert to idle) ───

  const handleClose = useCallback(() => {
    setMergeStatus(activeTabId, 'idle')
  }, [activeTabId, setMergeStatus])

  return (
    <AnimatePresence>
      {visible && pendingDiff && (
        <motion.div
          data-clui-ui
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.98 }}
          transition={{ duration: 0.26, ease: [0.4, 0, 0.1, 1] }}
          style={{
            borderRadius: 16,
            border: `1px solid ${colors.containerBorder}`,
            background: colors.containerBg,
            boxShadow: colors.cardShadow,
            overflow: 'hidden',
          }}
        >
          {/* ── Header ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderBottom: `1px solid ${colors.containerBorder}`,
            }}
          >
            <Check
              size={16}
              weight="bold"
              style={{ color: colors.statusComplete, flexShrink: 0 }}
            />
            <span
              style={{
                flex: 1,
                fontSize: 13,
                fontWeight: 600,
                color: colors.textPrimary,
              }}
            >
              Sandbox Run Complete
            </span>
            <button
              data-clui-ui
              onClick={handleClose}
              aria-label="Close sandbox summary"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                borderRadius: 4,
                border: 'none',
                background: 'transparent',
                color: colors.textTertiary,
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = colors.surfaceHover
                e.currentTarget.style.color = colors.textPrimary
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = colors.textTertiary
              }}
            >
              <X size={12} />
            </button>
          </div>

          {/* ── Diff stats row ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 12px',
              fontSize: 12,
            }}
          >
            <span style={{ color: colors.diffAddedBorder, fontWeight: 500 }}>
              +{pendingDiff.insertions}
            </span>
            <span style={{ color: colors.diffRemovedBorder, fontWeight: 500 }}>
              -{pendingDiff.deletions}
            </span>
            <span style={{ color: colors.textTertiary }}>
              {pendingDiff.filesChanged} file{pendingDiff.filesChanged !== 1 ? 's' : ''}
            </span>
          </div>

          {/* ── Collapsible file list ── */}
          <div style={{ padding: '0 12px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
                fontSize: 11,
                color: colors.textTertiary,
                paddingBottom: 4,
                userSelect: 'none',
              }}
              onClick={() => setFilesExpanded(!filesExpanded)}
            >
              {filesExpanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
              <span>Files</span>
            </div>

            <AnimatePresence>
              {filesExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div
                    style={{
                      maxHeight: 160,
                      overflowY: 'auto',
                      paddingBottom: 4,
                    }}
                  >
                    {pendingDiff.files.map((file) => (
                      <div
                        key={file.path}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 11,
                          lineHeight: '20px',
                        }}
                      >
                        <span
                          style={{
                            color: statusColor(file.status, colors),
                            fontWeight: 600,
                            fontFamily: 'monospace',
                            width: 12,
                            textAlign: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {file.status}
                        </span>
                        <span
                          style={{
                            flex: 1,
                            color: colors.textSecondary,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={file.path}
                        >
                          {file.path}
                        </span>
                        <span style={{ color: colors.diffAddedBorder, flexShrink: 0 }}>
                          +{file.insertions}
                        </span>
                        <span style={{ color: colors.diffRemovedBorder, flexShrink: 0 }}>
                          -{file.deletions}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Action buttons ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px 10px',
            }}
          >
            {/* Merge button (primary) */}
            <button
              data-clui-ui
              onClick={handleMerge}
              disabled={merging || reverting}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                background: merging || reverting ? colors.sendDisabled : colors.sendBg,
                color: colors.textOnAccent,
                fontSize: 12,
                fontWeight: 600,
                cursor: merging || reverting ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!merging && !reverting) {
                  e.currentTarget.style.background = colors.sendHover
                }
              }}
              onMouseLeave={(e) => {
                if (!merging && !reverting) {
                  e.currentTarget.style.background = colors.sendBg
                }
              }}
            >
              {merging ? (
                <SpinnerGap size={14} className="animate-spin" />
              ) : (
                <GitMerge size={14} />
              )}
              Merge to Main
            </button>

            {/* Discard button (secondary) */}
            <button
              data-clui-ui
              onClick={handleRevert}
              disabled={merging || reverting}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                border: `1px solid ${colors.containerBorder}`,
                background: 'transparent',
                color: merging || reverting ? colors.textTertiary : colors.textSecondary,
                fontSize: 12,
                fontWeight: 500,
                cursor: merging || reverting ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!merging && !reverting) {
                  e.currentTarget.style.background = colors.surfaceHover
                  e.currentTarget.style.color = colors.textPrimary
                }
              }}
              onMouseLeave={(e) => {
                if (!merging && !reverting) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = colors.textSecondary
                }
              }}
            >
              {reverting ? (
                <SpinnerGap size={14} className="animate-spin" />
              ) : (
                <ArrowClockwise size={14} />
              )}
              Discard
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
