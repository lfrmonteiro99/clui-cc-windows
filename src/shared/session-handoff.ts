/**
 * Session Handoff — generates a compressed context document for continuing
 * a session in a new tab when the context window is nearly full.
 */

import type { Message } from './types'

export interface HandoffDocument {
  goal: string
  completedSteps: string[]
  openDecisions: string[]
  fileStates: string[]
  nextSteps: string
}

/**
 * Extract the user's original goal from the first user message.
 */
function extractGoal(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === 'user')
  if (!firstUser) return 'Unknown goal'
  const text = firstUser.content.trim()
  // Take first sentence or first 150 chars
  const sentenceEnd = text.search(/[.!?]\s/)
  if (sentenceEnd > 0 && sentenceEnd < 150) return text.slice(0, sentenceEnd + 1)
  if (text.length <= 150) return text
  return text.slice(0, 147) + '...'
}

/**
 * Extract completed steps from tool messages.
 */
function extractCompletedSteps(messages: Message[]): string[] {
  const steps: string[] = []
  const seen = new Set<string>()

  for (const msg of messages) {
    if (msg.role !== 'tool' || msg.toolStatus !== 'completed' || !msg.toolName) continue

    let desc = msg.toolName
    if (msg.toolInput) {
      try {
        const parsed = JSON.parse(msg.toolInput)
        const filePath = parsed.file_path || parsed.path || ''
        if (filePath) desc = `${msg.toolName} ${filePath}`
        else if (parsed.command) desc = `Ran: ${parsed.command.slice(0, 60)}`
        else if (parsed.pattern) desc = `${msg.toolName}: ${parsed.pattern}`
      } catch { /* ignore */ }
    }

    if (!seen.has(desc)) {
      seen.add(desc)
      steps.push(desc)
    }
  }

  // Limit to most recent 15 steps
  return steps.slice(-15)
}

/**
 * Extract file paths that were modified (Edit/Write/MultiEdit).
 */
function extractFileStates(messages: Message[]): string[] {
  const files = new Set<string>()

  for (const msg of messages) {
    if (msg.role !== 'tool' || !msg.toolInput) continue
    if (msg.toolName !== 'Edit' && msg.toolName !== 'Write' && msg.toolName !== 'MultiEdit') continue

    try {
      const parsed = JSON.parse(msg.toolInput)
      const filePath = parsed.file_path || parsed.path
      if (filePath) files.add(filePath)
    } catch { /* ignore */ }
  }

  return [...files]
}

/**
 * Look for open questions/decisions in recent assistant messages.
 */
function extractOpenDecisions(messages: Message[]): string[] {
  const decisions: string[] = []
  // Check last 10 assistant messages for questions
  const recentAssistant = messages
    .filter((m) => m.role === 'assistant')
    .slice(-10)

  for (const msg of recentAssistant) {
    const lines = msg.content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.endsWith('?') && trimmed.length > 10 && trimmed.length < 200) {
        decisions.push(trimmed)
      }
    }
  }

  return decisions.slice(-5)
}

/**
 * Extract next steps from the last assistant message.
 */
function extractNextSteps(messages: Message[]): string {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  if (!lastAssistant) return 'Continue from where we left off.'

  const text = lastAssistant.content.trim()
  // Take last 200 chars as likely to contain next-step info
  if (text.length <= 200) return text
  return '...' + text.slice(-197)
}

/**
 * Generate a handoff document from conversation messages.
 */
export function generateHandoffDocument(messages: Message[]): HandoffDocument {
  return {
    goal: extractGoal(messages),
    completedSteps: extractCompletedSteps(messages),
    openDecisions: extractOpenDecisions(messages),
    fileStates: extractFileStates(messages),
    nextSteps: extractNextSteps(messages),
  }
}

/**
 * Format a handoff document as a prompt to inject in a new tab.
 */
export function formatHandoffAsPrompt(doc: HandoffDocument): string {
  const parts: string[] = [
    `Continue this session. Here's the context:`,
    '',
    `## Goal`,
    doc.goal,
  ]

  if (doc.completedSteps.length > 0) {
    parts.push('', '## Completed Steps')
    for (const step of doc.completedSteps) {
      parts.push(`- ${step}`)
    }
  }

  if (doc.fileStates.length > 0) {
    parts.push('', '## Files Modified')
    for (const file of doc.fileStates) {
      parts.push(`- ${file}`)
    }
  }

  if (doc.openDecisions.length > 0) {
    parts.push('', '## Open Questions')
    for (const q of doc.openDecisions) {
      parts.push(`- ${q}`)
    }
  }

  parts.push('', '## What to Do Next', doc.nextSteps)

  return parts.join('\n')
}
