/**
 * ENRICH-005: Rich Tool Timeline
 *
 * Enriches tool call labels with meaningful context (file names, command snippets).
 */

import type { Message } from '../types'

/**
 * Get an enriched display label for a tool call based on its name and input.
 */
export function getEnrichedToolLabel(toolName: string, toolInput?: string): string {
  if (!toolInput) return toolName

  try {
    const parsed = JSON.parse(toolInput)

    switch (toolName) {
      case 'Read': {
        const fp = parsed.file_path || parsed.path || ''
        if (fp) {
          const basename = fp.split(/[/\\]/).pop() || fp
          return `Read ${basename}`
        }
        return 'Read'
      }
      case 'Edit': {
        const fp = parsed.file_path || ''
        if (fp) {
          const basename = fp.split(/[/\\]/).pop() || fp
          return `Edit ${basename}`
        }
        return 'Edit'
      }
      case 'Write': {
        const fp = parsed.file_path || ''
        if (fp) {
          const basename = fp.split(/[/\\]/).pop() || fp
          return `Write ${basename}`
        }
        return 'Write'
      }
      case 'Bash': {
        const cmd = parsed.command || ''
        if (cmd.length > 60) {
          return `Bash: ${cmd.slice(0, 57)}...`
        }
        return cmd ? `Bash: ${cmd}` : 'Bash'
      }
      case 'Glob': {
        const pattern = parsed.pattern || ''
        return pattern ? `Glob ${pattern}` : 'Glob'
      }
      case 'Grep': {
        const pattern = parsed.pattern || ''
        return pattern ? `Grep "${pattern}"` : 'Grep'
      }
      default:
        return toolName
    }
  } catch {
    // Not valid JSON — return plain name
    return toolName
  }
}

/**
 * Extract unique file paths from all tool messages in a conversation.
 */
export function extractFilesFromTools(messages: Message[]): string[] {
  const files = new Set<string>()

  for (const msg of messages) {
    if (msg.role !== 'tool' || !msg.toolInput) continue
    try {
      const parsed = JSON.parse(msg.toolInput)
      const fp = parsed.file_path || parsed.path
      if (typeof fp === 'string' && fp.length > 0) {
        files.add(fp)
      }
    } catch {
      // skip non-JSON
    }
  }

  return Array.from(files)
}
