/**
 * ENRICH-001: Streaming Stats Bar
 *
 * Computes live statistics from streaming text chunks and token usage data.
 */

import type { Message, TokenUsageSnapshot } from '../types'

export interface StreamingStats {
  wordCount: number
  charCount: number
  estimatedCostUsd: number | null
}

/**
 * Count words from accumulated text chunks in a messages array.
 * Reads from `_textChunks` when available (streaming), otherwise from `content`.
 */
export function computeWordCount(messages: Message[]): number {
  let total = 0
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    const text = msg._textChunks ? msg._textChunks.join('') : msg.content
    if (!text) continue
    const words = text.trim().split(/\s+/).filter(Boolean)
    total += words.length
  }
  return total
}

/**
 * Count characters from accumulated text chunks in a messages array.
 */
export function computeCharCount(messages: Message[]): number {
  let total = 0
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    const text = msg._textChunks ? msg._textChunks.join('') : msg.content
    if (text) total += text.length
  }
  return total
}

// Rough per-token pricing (blended average for Sonnet-class models)
const INPUT_COST_PER_TOKEN = 3e-6
const OUTPUT_COST_PER_TOKEN = 15e-6
const CACHE_READ_COST_PER_TOKEN = 0.3e-6

/**
 * Estimate session cost from cumulative token usage.
 * Returns null if no usage data is available.
 */
export function estimateCost(usage: TokenUsageSnapshot | null): number | null {
  if (!usage || usage.totalTokens === 0) return null
  return (
    usage.inputTokens * INPUT_COST_PER_TOKEN +
    usage.outputTokens * OUTPUT_COST_PER_TOKEN +
    usage.cacheReadTokens * CACHE_READ_COST_PER_TOKEN
  )
}

/**
 * Build a full streaming stats snapshot.
 */
export function computeStreamingStats(
  messages: Message[],
  tokenUsage: TokenUsageSnapshot | null,
): StreamingStats {
  return {
    wordCount: computeWordCount(messages),
    charCount: computeCharCount(messages),
    estimatedCostUsd: estimateCost(tokenUsage),
  }
}
