import React, { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle, Copy, Check, FileCode, Timer, CurrencyDollar,
  Wrench, CaretDown, CaretUp,
} from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../theme'
import { extractCodeBlocks, extractFilesTouched, countToolCalls } from '../../shared/completion-utils'

// ─── Formatting Helpers (same as CostDashboard) ───

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`
  return `${(count / 1_000_000).toFixed(2)}M`
}

function shortenPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  if (parts.length <= 2) return path
  return parts.slice(-2).join('/')
}

// ─── Component ───

export function CompletionSummary({ tabId }: { tabId: string }) {
  const colors = useColors()
  const [expanded, setExpanded] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedResponse, setCopiedResponse] = useState(false)

  const tab = useSessionStore(
    (s) => s.tabs.find((t) => t.id === tabId),
    (a, b) => {
      if (a === b) return true
      if (!a || !b) return a === b
      return (
        a.id === b.id &&
        a.status === b.status &&
        a.lastResult === b.lastResult &&
        a.tokenUsage === b.tokenUsage &&
        a.messages.length === b.messages.length
      )
    },
  )

  const messages = tab?.messages ?? []
  const lastResult = tab?.lastResult ?? null
  const tokenUsage = tab?.tokenUsage ?? null
  const isCompleted = tab?.status === 'completed'

  const toolCallCount = useMemo(() => countToolCalls(messages), [messages])
  const filesTouched = useMemo(() => extractFilesTouched(messages), [messages])
  const codeBlocks = useMemo(() => extractCodeBlocks(messages), [messages])

  // Build the last assistant response text
  const lastAssistantText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].content.trim()) {
        return messages[i].content
      }
    }
    return ''
  }, [messages])

  const handleCopyCode = useCallback(async () => {
    if (codeBlocks.length === 0) return
    try {
      await navigator.clipboard.writeText(codeBlocks.join('\n\n'))
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 1500)
    } catch (err) {
      console.warn('[CompletionSummary] Failed to copy code:', err)
    }
  }, [codeBlocks])

  const handleCopyResponse = useCallback(async () => {
    if (!lastAssistantText) return
    try {
      await navigator.clipboard.writeText(lastAssistantText)
      setCopiedResponse(true)
      setTimeout(() => setCopiedResponse(false), 1500)
    } catch (err) {
      console.warn('[CompletionSummary] Failed to copy response:', err)
    }
  }, [lastAssistantText])

  if (!isCompleted || !lastResult) return null

  const inputTokens = tokenUsage?.inputTokens ?? 0
  const outputTokens = tokenUsage?.outputTokens ?? 0
  const cacheReadTokens = tokenUsage?.cacheReadTokens ?? 0

  // Collapsed summary line
  const summaryParts: string[] = []
  if (lastResult.durationMs > 0) summaryParts.push(formatDuration(lastResult.durationMs))
  if (lastResult.totalCostUsd > 0) summaryParts.push(formatCost(lastResult.totalCostUsd))
  if (toolCallCount > 0) summaryParts.push(`${toolCallCount} tool call${toolCallCount === 1 ? '' : 's'}`)
  if (filesTouched.length > 0) summaryParts.push(`${filesTouched.length} file${filesTouched.length === 1 ? '' : 's'}`)
  const summaryLine = summaryParts.join(' \u00b7 ')

  return (
    <motion.div
      data-testid="completion-summary"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      style={{
        marginTop: 12,
        borderRadius: 12,
        border: `1px solid ${colors.containerBorder}`,
        background: colors.surfaceHover,
        boxShadow: colors.cardShadow,
        overflow: 'hidden',
      }}
    >
      {/* Collapsed header row */}
      <button
        data-testid="completion-summary-toggle"
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '10px 14px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <CheckCircle size={14} weight="fill" style={{ color: colors.statusComplete, flexShrink: 0 }} />
        <span
          data-testid="completion-summary-line"
          style={{
            fontSize: 11,
            color: colors.textSecondary,
            flex: 1,
            textAlign: 'left',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {summaryLine || 'Task complete'}
        </span>
        <span style={{ color: colors.textTertiary, display: 'flex', flexShrink: 0 }}>
          {expanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
        </span>
      </button>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            data-testid="completion-summary-details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              padding: '0 14px 12px',
              borderTop: `1px solid ${colors.containerBorder}`,
            }}>
              {/* Metrics grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8,
                marginTop: 10,
              }}>
                {/* Duration */}
                <MetricItem
                  icon={<Timer size={12} />}
                  label="Duration"
                  value={formatDuration(lastResult.durationMs)}
                  colors={colors}
                />

                {/* Cost */}
                <MetricItem
                  icon={<CurrencyDollar size={12} />}
                  label="Cost"
                  value={formatCost(lastResult.totalCostUsd)}
                  colors={colors}
                />

                {/* Tool calls */}
                <MetricItem
                  icon={<Wrench size={12} />}
                  label="Tool calls"
                  value={String(toolCallCount)}
                  colors={colors}
                />

                {/* Files modified */}
                <MetricItem
                  icon={<FileCode size={12} />}
                  label="Files"
                  value={String(filesTouched.length)}
                  colors={colors}
                />
              </div>

              {/* Token breakdown */}
              {(inputTokens > 0 || outputTokens > 0) && (
                <div style={{ marginTop: 10 }}>
                  <div style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: colors.textTertiary,
                    marginBottom: 4,
                  }}>
                    Tokens
                  </div>
                  <div
                    data-testid="completion-summary-tokens"
                    style={{
                      display: 'flex',
                      gap: 12,
                      fontSize: 11,
                      color: colors.textSecondary,
                    }}
                  >
                    <span>{formatTokens(inputTokens)} in</span>
                    <span>{formatTokens(outputTokens)} out</span>
                    {cacheReadTokens > 0 && (
                      <span style={{ color: colors.textTertiary }}>
                        {formatTokens(cacheReadTokens)} cache
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Files list */}
              {filesTouched.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: colors.textTertiary,
                    marginBottom: 4,
                  }}>
                    Files modified
                  </div>
                  <div
                    data-testid="completion-summary-files"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    {filesTouched.slice(0, 10).map((fp) => (
                      <div
                        key={fp}
                        style={{
                          fontSize: 10,
                          color: colors.textTertiary,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={fp}
                      >
                        {shortenPath(fp)}
                      </div>
                    ))}
                    {filesTouched.length > 10 && (
                      <div style={{ fontSize: 10, color: colors.textTertiary }}>
                        +{filesTouched.length - 10} more
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Quick actions */}
              <div style={{
                display: 'flex',
                gap: 6,
                marginTop: 10,
              }}>
                {codeBlocks.length > 0 && (
                  <ActionButton
                    data-testid="completion-copy-code"
                    label={copiedCode ? 'Copied!' : 'Copy all code'}
                    icon={copiedCode ? <Check size={11} /> : <Copy size={11} />}
                    active={copiedCode}
                    onClick={handleCopyCode}
                    colors={colors}
                  />
                )}
                {lastAssistantText && (
                  <ActionButton
                    data-testid="completion-copy-response"
                    label={copiedResponse ? 'Copied!' : 'Copy response'}
                    icon={copiedResponse ? <Check size={11} /> : <Copy size={11} />}
                    active={copiedResponse}
                    onClick={handleCopyResponse}
                    colors={colors}
                  />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Sub-components ───

function MetricItem({ icon, label, value, colors }: {
  icon: React.ReactNode
  label: string
  value: string
  colors: ReturnType<typeof useColors>
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 8px',
      borderRadius: 8,
      background: colors.surfacePrimary,
    }}>
      <span style={{ color: colors.textTertiary, display: 'flex' }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: colors.textTertiary }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.textPrimary }}>{value}</div>
      </div>
    </div>
  )
}

function ActionButton({ label, icon, active, onClick, colors, ...rest }: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  colors: ReturnType<typeof useColors>
  'data-testid'?: string
}) {
  return (
    <button
      {...rest}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '5px 10px',
        borderRadius: 8,
        border: `1px solid ${active ? colors.statusComplete : colors.containerBorder}`,
        background: active ? colors.statusCompleteBg : 'transparent',
        color: active ? colors.statusComplete : colors.textSecondary,
        fontSize: 11,
        fontFamily: 'inherit',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
