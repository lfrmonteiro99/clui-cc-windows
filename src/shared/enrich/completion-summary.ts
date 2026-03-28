/**
 * ENRICH-003: Completion Summary Card
 *
 * Extracts structured summary data from a completed session's messages:
 * code blocks, files touched, tool call count, etc.
 */

import type { Message } from '../types'

export interface CodeBlock {
  language: string
  code: string
}

const CODE_BLOCK_RE = /```(\w*)\n([\s\S]*?)```/g

/**
 * Extract fenced code blocks from assistant messages.
 */
export function extractCodeBlocks(messages: Message[]): CodeBlock[] {
  const blocks: CodeBlock[] = []
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    const text = msg._textChunks ? msg._textChunks.join('') : msg.content
    if (!text) continue
    let match: RegExpExecArray | null
    const re = new RegExp(CODE_BLOCK_RE.source, CODE_BLOCK_RE.flags)
    while ((match = re.exec(text)) !== null) {
      blocks.push({
        language: match[1] || 'text',
        code: match[2].trim(),
      })
    }
  }
  return blocks
}

/** Match absolute file paths (Unix and Windows styles). */
const FILE_PATH_RE = /(?:[A-Z]:[/\\]|\/)[^\s"'`,;:*?<>|()[\]{}]+\.\w+/gi

/**
 * Extract unique file paths from tool messages (toolInput JSON and content).
 */
export function extractFilesTouched(messages: Message[]): string[] {
  const paths = new Set<string>()

  for (const msg of messages) {
    if (msg.role !== 'tool') continue

    if (msg.toolInput) {
      try {
        const parsed = JSON.parse(msg.toolInput)
        const fp = parsed.file_path || parsed.path
        if (typeof fp === 'string' && fp.length > 0) {
          paths.add(fp)
        }
      } catch {
        const matches = msg.toolInput.match(FILE_PATH_RE)
        if (matches) {
          for (const m of matches) paths.add(m)
        }
      }
    }

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
 * Count total tool calls in a message array.
 */
export function countToolCalls(messages: Message[]): number {
  return messages.filter((m) => m.role === 'tool').length
}
