import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Timer, TextT, Coins, Hash } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../theme'

// ─── Pure utility functions (exported for testing) ───

/** Count words in text by splitting on whitespace */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/** Estimate cost in USD from output tokens. Rough per-model pricing (output $/MTok). */
export function estimateCost(outputTokens: number, model: string | null): number {
  // Output pricing per million tokens
  let pricePerMTok = 15 // default (Opus/Sonnet)
  if (model && /haiku/i.test(model)) {
    pricePerMTok = 5
  }
  return (outputTokens / 1_000_000) * pricePerMTok
}

/** Format cost as dollar string */
export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

/** Format token count with k/M suffix */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`
  return `${(count / 1_000_000).toFixed(2)}M`
}

/** Format elapsed seconds into human readable duration */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

// ─── Component ───

interface StreamingStatsBarProps {
  tabId: string
  elapsedSeconds: number
}

export const StreamingStatsBar = React.memo(function StreamingStatsBar({
  tabId,
  elapsedSeconds,
}: StreamingStatsBarProps) {
  const colors = useColors()

  // Narrow selectors to minimize re-renders
  const status = useSessionStore(
    (s) => s.tabs.find((t) => t.id === tabId)?.status ?? 'idle',
  )
  const lastMsgContent = useSessionStore(
    (s) => {
      const tab = s.tabs.find((t) => t.id === tabId)
      if (!tab) return ''
      const msgs = tab.messages
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') return msgs[i].content
      }
      return ''
    },
  )
  const outputTokens = useSessionStore(
    (s) => s.tabs.find((t) => t.id === tabId)?.tokenUsage?.outputTokens ?? 0,
  )
  const model = useSessionStore(
    (s) => s.tabs.find((t) => t.id === tabId)?.sessionModel ?? null,
  )

  const isStreaming = status === 'running' || status === 'connecting'
  const hasContent = lastMsgContent.length > 0
  const visible = isStreaming && hasContent

  const words = countWords(lastMsgContent)
  const cost = estimateCost(outputTokens, model)

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          data-testid="streaming-stats-bar"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.15 }}
          className="flex items-center gap-3 px-4 py-1 font-mono text-[10px] select-none overflow-hidden"
          style={{ color: colors.textTertiary }}
        >
          <span className="flex items-center gap-1" title="Word count">
            <TextT size={10} style={{ color: colors.textTertiary }} />
            <span>{words.toLocaleString()} words</span>
          </span>

          <span className="flex items-center gap-1" title="Output tokens">
            <Hash size={10} style={{ color: colors.textTertiary }} />
            <span>{formatTokens(outputTokens)} tokens</span>
          </span>

          <span className="flex items-center gap-1" title="Elapsed time">
            <Timer size={10} style={{ color: colors.textTertiary }} />
            <span>{formatElapsed(elapsedSeconds)}</span>
          </span>

          {outputTokens > 0 && (
            <span className="flex items-center gap-1" title="Estimated cost">
              <Coins size={10} style={{ color: colors.textTertiary }} />
              <span>~{formatCost(cost)}</span>
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
})
