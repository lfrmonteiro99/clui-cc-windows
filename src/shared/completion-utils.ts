import type { Message } from './types'

/** Match absolute file paths in tool messages (Unix and Windows styles). */
const FILE_PATH_RE = /(?:[A-Z]:[/\\]|\/)[^\s"'`,;:*?<>|()[\]{}]+\.\w+/gi

/**
 * Extract all fenced code blocks from assistant messages.
 * Returns the raw code content (without the ``` delimiters).
 */
export function extractCodeBlocks(messages: Message[]): string[] {
  const blocks: string[] = []
  const codeBlockRe = /```[^\n]*\n([\s\S]*?)```/g

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    let match: RegExpExecArray | null
    while ((match = codeBlockRe.exec(msg.content)) !== null) {
      const code = match[1].trimEnd()
      if (code.length > 0) {
        blocks.push(code)
      }
    }
  }

  return blocks
}

/**
 * Extract unique file paths mentioned in tool messages.
 * Looks at toolInput JSON (file_path, path fields) and scans content for path patterns.
 */
export function extractFilesTouched(messages: Message[]): string[] {
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
 * Count the number of tool call messages.
 */
export function countToolCalls(messages: Message[]): number {
  return messages.filter((m) => m.role === 'tool').length
}
