import type { Message, TabStatus } from './types'

// ─── Resume Brief Types ───

export interface ResumeBrief {
  lastTask: string
  filesTouched: string[]
  status: 'completed' | 'interrupted' | 'in_progress'
  lastActivityAt: number
  messageCount: number
}

/** Inactivity threshold before showing a resume brief (10 minutes). */
export const RESUME_INACTIVITY_MS = 10 * 60 * 1000

/** The prompt sent when the user clicks "Catch me up". */
export const CATCH_ME_UP_PROMPT =
  'Please give me a brief summary of where we left off and what still needs to be done.'

// ─── Helpers ───

/**
 * Extract a short task description from the last assistant message.
 * Takes the first sentence or first 100 characters, whichever is shorter.
 */
function extractLastTask(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].content.trim()) {
      const text = messages[i].content.trim()
      // Try to get the first sentence
      const sentenceMatch = text.match(/^[^.!?\n]+[.!?]/)
      if (sentenceMatch && sentenceMatch[0].length <= 100) {
        return sentenceMatch[0]
      }
      // Fall back to first 100 chars
      if (text.length <= 100) return text
      return text.slice(0, 97) + '...'
    }
  }
  return 'No task information available'
}

/** Match absolute file paths in tool messages (Unix and Windows styles). */
const FILE_PATH_RE = /(?:[A-Z]:[/\\]|\/)[^\s"'`,;:*?<>|()[\]{}]+\.\w+/gi

/**
 * Extract unique file paths mentioned in tool messages.
 * Looks at tool messages whose toolName is a file-touching tool (Read, Edit, Write, Glob, Grep, Bash)
 * and also scans content for path-like patterns.
 */
function extractFilesTouched(messages: Message[]): string[] {
  const paths = new Set<string>()

  for (const msg of messages) {
    if (msg.role !== 'tool') continue

    // Extract from tool input JSON
    if (msg.toolInput) {
      try {
        const parsed = JSON.parse(msg.toolInput)
        const fp = parsed.file_path || parsed.path
        if (typeof fp === 'string' && fp.length > 0) {
          paths.add(fp)
        }
      } catch {
        // Not valid JSON — try regex on raw input
        const matches = msg.toolInput.match(FILE_PATH_RE)
        if (matches) {
          for (const m of matches) paths.add(m)
        }
      }
    }

    // Also scan content for paths
    if (msg.content) {
      const matches = msg.content.match(FILE_PATH_RE)
      if (matches) {
        for (const m of matches) paths.add(m)
      }
    }
  }

  return Array.from(paths)
}

/**
 * Map a tab status to a resume brief status.
 */
function deriveStatus(tabStatus: TabStatus): ResumeBrief['status'] {
  if (tabStatus === 'completed') return 'completed'
  if (tabStatus === 'running' || tabStatus === 'connecting') return 'in_progress'
  return 'interrupted'
}

/**
 * Find the timestamp of the last activity (most recent message).
 */
function findLastActivityAt(messages: Message[]): number {
  if (messages.length === 0) return 0
  return messages[messages.length - 1].timestamp
}

// ─── Main Export ───

/**
 * Generate a resume brief from the current tab's messages and status.
 * Returns null if there are no messages.
 */
export function generateResumeBrief(messages: Message[], tabStatus: TabStatus): ResumeBrief | null {
  if (messages.length === 0) return null

  return {
    lastTask: extractLastTask(messages),
    filesTouched: extractFilesTouched(messages),
    status: deriveStatus(tabStatus),
    lastActivityAt: findLastActivityAt(messages),
    messageCount: messages.length,
  }
}
