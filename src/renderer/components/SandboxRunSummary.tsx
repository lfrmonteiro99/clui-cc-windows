/**
 * SandboxRunSummary — elevated modal panel shown after a sandboxed run completes.
 * Displays diff stats (insertions, deletions, files) and merge/revert/test action buttons.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check,
  X,
  CaretDown,
  CaretRight,
  GitMerge,
  ArrowClockwise,
  SpinnerGap,
  Flask,
  ArrowRight,
  PuzzlePiece,
} from '@phosphor-icons/react'
import { useColors } from '../theme'
import { useSandboxStore } from '../stores/sandboxStore'
import { useSessionStore } from '../stores/sessionStore'
import { useNotificationStore } from '../stores/notificationStore'
import { useMarketplaceStore } from '../stores/marketplaceStore'
import type { MergeResult } from '../../shared/sandbox-types'

// ─── Playwright detection (zero tokens — reads installed plugins from store) ───

function useHasPlaywright(): boolean | null {
  const installedNames = useMarketplaceStore((s) => s.installedNames)
  const [checked, setChecked] = useState(false)
  const [has, setHas] = useState<boolean | null>(null)

  useEffect(() => {
    if (checked) return
    // Check from already-loaded marketplace data (no IPC, no tokens)
    const names = installedNames.map((n) => (typeof n === 'string' ? n : '').toLowerCase())
    const found = names.some((n) => n.includes('playwright') || n.includes('webapp-testing'))
    if (installedNames.length > 0) {
      setHas(found)
      setChecked(true)
    } else {
      // Marketplace not loaded yet — try filesystem check via IPC (still no Claude tokens)
      window.clui.listInstalledPlugins().then((entries) => {
        const installed = (entries || []).map((e: unknown) =>
          typeof e === 'string' ? e.toLowerCase() : ((e as { name?: string })?.name || '').toLowerCase()
        )
        setHas(installed.some((n: string) => n.includes('playwright') || n.includes('webapp-testing')))
        setChecked(true)
      }).catch(() => {
        setHas(false)
        setChecked(true)
      })
    }
  }, [installedNames, checked])

  return has
}

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

const DEFAULT_TEST_PROMPT = 'Run the tests against the changes in this worktree and report results'

export const SandboxRunSummary = React.memo(function SandboxRunSummary() {
  const colors = useColors()
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const pendingDiff = useSandboxStore((s) => activeTabId ? s.tabStates.get(activeTabId)?.pendingDiff ?? null : null)
  const mergeStatus = useSandboxStore((s) => activeTabId ? s.tabStates.get(activeTabId)?.mergeStatus ?? 'idle' : 'idle')
  const wt = useSandboxStore((s) => activeTabId ? s.tabStates.get(activeTabId)?.activeWorktree ?? null : null)
  const setMergeStatus = useSandboxStore((s) => s.setMergeStatus)
  const addToast = useNotificationStore((s) => s.addToast)
  const sendMessage = useSessionStore((s) => s.sendMessage)
  const openMarketplace = useMarketplaceStore((s) => s.openMarketplace)

  const hasPlaywright = useHasPlaywright()

  const [filesExpanded, setFilesExpanded] = useState(false)
  const [merging, setMerging] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [testPromptOpen, setTestPromptOpen] = useState(false)
  const [testPrompt, setTestPrompt] = useState(DEFAULT_TEST_PROMPT)
  const [testing, setTesting] = useState(false)
  const testInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus the test input when opened
  useEffect(() => {
    if (testPromptOpen && testInputRef.current) {
      testInputRef.current.focus()
      testInputRef.current.select()
    }
  }, [testPromptOpen])

  // Visibility: only show when there is a pending diff AND merge is still pending
  const visible = pendingDiff !== null && mergeStatus === 'pending'

  // ─── Test handler ───

  const handleTest = useCallback(() => {
    if (!wt || !activeTabId || !testPrompt.trim()) return
    setTesting(true)
    setTestPromptOpen(false)

    // Send a prompt to Claude Code CLI with the worktree as the working directory.
    // sendMessage accepts projectPath as second arg (string, not object).
    sendMessage(testPrompt.trim(), wt.path)

    // Reset after a beat — the run is now in the conversation
    setTimeout(() => setTesting(false), 1500)
  }, [wt, activeTabId, testPrompt, sendMessage])

  const handleTestKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleTest()
    }
    if (e.key === 'Escape') {
      setTestPromptOpen(false)
    }
  }, [handleTest])

  // ─── Merge handler ───

  const handleMerge = useCallback(async () => {
    if (!wt || !pendingDiff) return
    setMerging(true)
    try {
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
          title: 'Changes merged',
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
        title: 'Changes discarded',
        message: 'All changes have been reverted',
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

  // ─── Close ───

  const handleClose = useCallback(() => {
    setMergeStatus(activeTabId, 'idle')
  }, [activeTabId, setMergeStatus])

  const busy = merging || reverting || testing

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
              Safe Mode — Run Complete
            </span>
            <button
              data-clui-ui
              onClick={handleClose}
              aria-label="Close summary"
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

          {/* ── Test prompt (expandable inline input) ── */}
          <AnimatePresence>
            {testPromptOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                style={{ overflow: 'hidden' }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    margin: '0 12px',
                    padding: '8px 10px',
                    borderRadius: 10,
                    background: colors.inputPillBg,
                    border: `1px solid ${colors.accentBorder}`,
                  }}
                >
                  <Flask size={14} style={{ color: colors.accent, flexShrink: 0 }} />
                  <input
                    ref={testInputRef}
                    type="text"
                    value={testPrompt}
                    onChange={(e) => setTestPrompt(e.target.value)}
                    onKeyDown={handleTestKeyDown}
                    placeholder="What should I test?"
                    style={{
                      flex: 1,
                      background: 'none',
                      border: 'none',
                      outline: 'none',
                      color: colors.textPrimary,
                      fontSize: 12,
                      fontFamily: 'inherit',
                    }}
                  />
                  <button
                    data-clui-ui
                    onClick={handleTest}
                    disabled={!testPrompt.trim()}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 26,
                      height: 26,
                      borderRadius: 7,
                      border: 'none',
                      background: testPrompt.trim() ? colors.accent : colors.surfaceHover,
                      color: testPrompt.trim() ? '#fff' : colors.textTertiary,
                      cursor: testPrompt.trim() ? 'pointer' : 'default',
                      transition: 'background 0.15s',
                      flexShrink: 0,
                    }}
                  >
                    <ArrowRight size={13} weight="bold" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Action buttons ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px 10px',
            }}
          >
            {/* Test button — only if Playwright is installed */}
            {hasPlaywright === true && (
              <button
                data-clui-ui
                onClick={() => setTestPromptOpen(!testPromptOpen)}
                disabled={busy}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: `1px solid ${testPromptOpen ? colors.accent : colors.accentBorder}`,
                  background: testPromptOpen ? colors.accentLight : 'transparent',
                  color: busy ? colors.textTertiary : colors.accent,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  if (!busy) e.currentTarget.style.background = colors.accentLight
                }}
                onMouseLeave={(e) => {
                  if (!busy && !testPromptOpen) e.currentTarget.style.background = 'transparent'
                }}
              >
                {testing ? (
                  <SpinnerGap size={14} className="animate-spin" />
                ) : (
                  <Flask size={14} weight="fill" />
                )}
                Test
              </button>
            )}

            {/* Suggest installing Playwright if not available */}
            {hasPlaywright === false && (
              <button
                data-clui-ui
                onClick={() => openMarketplace()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: `1px dashed ${colors.containerBorder}`,
                  background: 'transparent',
                  color: colors.textTertiary,
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
                title="Install Playwright plugin to test changes before merging"
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = colors.accentBorder
                  e.currentTarget.style.color = colors.accent
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = colors.containerBorder
                  e.currentTarget.style.color = colors.textTertiary
                }}
              >
                <PuzzlePiece size={12} />
                Add testing
              </button>
            )}

            {/* Merge button (primary) */}
            <button
              data-clui-ui
              onClick={handleMerge}
              disabled={busy}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                background: busy ? colors.sendDisabled : colors.sendBg,
                color: colors.textOnAccent,
                fontSize: 12,
                fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!busy) e.currentTarget.style.background = colors.sendHover
              }}
              onMouseLeave={(e) => {
                if (!busy) e.currentTarget.style.background = colors.sendBg
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
              disabled={busy}
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
                color: busy ? colors.textTertiary : colors.textSecondary,
                fontSize: 12,
                fontWeight: 500,
                cursor: busy ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!busy) {
                  e.currentTarget.style.background = colors.surfaceHover
                  e.currentTarget.style.color = colors.textPrimary
                }
              }}
              onMouseLeave={(e) => {
                if (!busy) {
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
