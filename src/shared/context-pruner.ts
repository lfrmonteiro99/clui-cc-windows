/**
 * Smart Context Pruning — analyzes conversation history for "dead weight"
 * and provides suggestions for collapsing/summarizing redundant content.
 *
 * This is VISUAL only — it suggests which messages to collapse in the UI,
 * it does NOT delete messages.
 */

import type { Message } from './types'

export interface PruneAction {
  type: 'collapse' | 'summarize' | 'remove'
  messageIds: string[]
  reason: string
  summary?: string
}

export interface PruneResult {
  originalCount: number
  prunedCount: number
  savedTokens: number
  actions: PruneAction[]
}

/** Rough token estimate: ~4 characters per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Detect file reads that were followed by writes to the same file.
 * The read content is redundant once the file was written.
 */
function findRedundantReads(messages: Message[]): PruneAction[] {
  const actions: PruneAction[] = []
  const fileReadMessages = new Map<string, string[]>() // filePath → messageIds

  for (const msg of messages) {
    if (msg.role !== 'tool' || !msg.toolName || !msg.toolInput) continue

    let filePath: string | undefined
    try {
      const parsed = JSON.parse(msg.toolInput)
      filePath = parsed.file_path || parsed.path
    } catch { continue }

    if (!filePath) continue

    if (msg.toolName === 'Read') {
      const existing = fileReadMessages.get(filePath) || []
      existing.push(msg.id)
      fileReadMessages.set(filePath, existing)
    } else if (msg.toolName === 'Edit' || msg.toolName === 'Write' || msg.toolName === 'MultiEdit') {
      const readIds = fileReadMessages.get(filePath)
      if (readIds && readIds.length > 0) {
        actions.push({
          type: 'collapse',
          messageIds: readIds,
          reason: `Read of ${filePath} superseded by ${msg.toolName}`,
        })
        fileReadMessages.delete(filePath)
      }
    }
  }
  return actions
}

/**
 * Detect duplicate reads of the same file — keep only the latest.
 */
function findDuplicateReads(messages: Message[]): PruneAction[] {
  const actions: PruneAction[] = []
  const fileReads = new Map<string, string[]>()

  for (const msg of messages) {
    if (msg.role !== 'tool' || msg.toolName !== 'Read' || !msg.toolInput) continue
    let filePath: string | undefined
    try {
      const parsed = JSON.parse(msg.toolInput)
      filePath = parsed.file_path || parsed.path
    } catch { continue }
    if (!filePath) continue

    const existing = fileReads.get(filePath) || []
    existing.push(msg.id)
    fileReads.set(filePath, existing)
  }

  for (const [filePath, ids] of fileReads) {
    if (ids.length > 1) {
      // Keep the last one, collapse the rest
      const toCollapse = ids.slice(0, -1)
      actions.push({
        type: 'collapse',
        messageIds: toCollapse,
        reason: `Duplicate reads of ${filePath} (keeping latest)`,
      })
    }
  }
  return actions
}

/**
 * Detect correction loops: user says "no"/"wrong"/"instead" → assistant corrects.
 * Collapse the loop to just the final correction.
 */
function findCorrectionLoops(messages: Message[]): PruneAction[] {
  const actions: PruneAction[] = []
  const correctionPatterns = /\b(no[,.]|wrong|instead|that's not|not what|incorrect|fix that|try again)\b/i

  for (let i = 1; i < messages.length - 1; i++) {
    const msg = messages[i]
    if (msg.role !== 'user') continue
    if (!correctionPatterns.test(msg.content)) continue

    // Check if prev was assistant and next is assistant (correction loop)
    const prev = messages[i - 1]
    const next = messages[i + 1]
    if (prev?.role === 'assistant' && next?.role === 'assistant') {
      actions.push({
        type: 'summarize',
        messageIds: [prev.id, msg.id],
        reason: 'Correction loop (superseded by next response)',
        summary: `[Corrected: ${msg.content.slice(0, 60)}${msg.content.length > 60 ? '...' : ''}]`,
      })
    }
  }
  return actions
}

/**
 * Mark old tool outputs (more than threshold messages ago) as collapsible.
 */
function findOldToolOutputs(messages: Message[], threshold = 30): PruneAction[] {
  const actions: PruneAction[] = []
  if (messages.length <= threshold) return actions

  const cutoff = messages.length - threshold
  const oldToolIds: string[] = []

  for (let i = 0; i < cutoff; i++) {
    const msg = messages[i]
    if (msg.role === 'tool' && msg.toolStatus === 'completed') {
      oldToolIds.push(msg.id)
    }
  }

  if (oldToolIds.length > 0) {
    actions.push({
      type: 'collapse',
      messageIds: oldToolIds,
      reason: `${oldToolIds.length} old tool outputs (>${threshold} messages ago)`,
    })
  }
  return actions
}

/**
 * Analyze a message array for pruning opportunities.
 */
export function analyzeForPruning(messages: Message[]): PruneResult {
  const actions: PruneAction[] = [
    ...findRedundantReads(messages),
    ...findDuplicateReads(messages),
    ...findCorrectionLoops(messages),
    ...findOldToolOutputs(messages),
  ]

  // Deduplicate message IDs across actions
  const allPrunedIds = new Set<string>()
  for (const action of actions) {
    for (const id of action.messageIds) allPrunedIds.add(id)
  }

  // Estimate saved tokens
  let savedTokens = 0
  for (const msg of messages) {
    if (allPrunedIds.has(msg.id)) {
      savedTokens += estimateTokens(msg.content)
      if (msg.toolInput) savedTokens += estimateTokens(msg.toolInput)
    }
  }

  return {
    originalCount: messages.length,
    prunedCount: allPrunedIds.size,
    savedTokens,
    actions,
  }
}
