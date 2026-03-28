// ─── Tool Enrichment: Rich labels and file extraction from tool messages ───

import type { Message } from './types'

export interface FileEntry {
  path: string
  operations: ('read' | 'edited' | 'created' | 'searched' | 'ran')[]
}

/**
 * Parse toolInput JSON safely, returning null on failure.
 */
function safeParse(toolInput: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(toolInput)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/**
 * Extract basename from a file path.
 */
function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

/**
 * Truncate a string to max length with ellipsis.
 */
function truncate(str: string, max: number): string {
  return str.length > max ? `${str.substring(0, max - 1)}\u2026` : str
}

/**
 * Count diff stats (added/removed lines) from old_string and new_string.
 */
function diffStats(oldStr: string, newStr: string): string {
  const removed = oldStr ? oldStr.split('\n').length : 0
  const added = newStr ? newStr.split('\n').length : 0
  return `+${added} \u2212${removed}`
}

/**
 * Create an enriched, human-readable label for a tool call.
 *
 * Examples:
 *   - "Reading `src/main/index.ts`"
 *   - "Editing `package.json` (+3 −1)"
 *   - "Running `npm test`"
 *   - "Searching for `useColors` in src/"
 *
 * Falls back gracefully to the raw toolName when parsing fails.
 */
export function getEnrichedToolLabel(toolName: string, toolInput?: string): string {
  if (!toolInput) return toolName

  const parsed = safeParse(toolInput)
  if (!parsed) return toolName

  switch (toolName) {
    case 'Read': {
      const fp = typeof parsed.file_path === 'string'
        ? parsed.file_path
        : typeof parsed.path === 'string'
          ? parsed.path
          : ''
      if (!fp) return 'Read'
      return `Reading \`${basename(fp)}\``
    }
    case 'Edit': {
      const fp = typeof parsed.file_path === 'string' ? parsed.file_path : ''
      if (!fp) return 'Edit'
      const oldStr = typeof parsed.old_string === 'string' ? parsed.old_string : ''
      const newStr = typeof parsed.new_string === 'string' ? parsed.new_string : ''
      const stats = (oldStr || newStr) ? ` (${diffStats(oldStr, newStr)})` : ''
      return `Editing \`${basename(fp)}\`${stats}`
    }
    case 'Write': {
      const fp = typeof parsed.file_path === 'string' ? parsed.file_path : ''
      if (!fp) return 'Write'
      return `Creating \`${basename(fp)}\``
    }
    case 'Bash': {
      const cmd = typeof parsed.command === 'string' ? parsed.command.trim() : ''
      if (!cmd) return 'Bash'
      return `Running \`${truncate(cmd, 40)}\``
    }
    case 'Grep': {
      const pattern = typeof parsed.pattern === 'string' ? parsed.pattern : ''
      const path = typeof parsed.path === 'string' ? parsed.path : ''
      if (!pattern) return 'Grep'
      const inPath = path ? ` in ${path}` : ''
      return `Searching for \`${truncate(pattern, 30)}\`${inPath}`
    }
    case 'Glob': {
      const pattern = typeof parsed.pattern === 'string' ? parsed.pattern : ''
      if (!pattern) return 'Glob'
      return `Finding files \`${truncate(pattern, 30)}\``
    }
    case 'WebSearch': {
      const query = typeof parsed.query === 'string'
        ? parsed.query
        : typeof parsed.search_query === 'string'
          ? parsed.search_query
          : ''
      if (!query) return 'WebSearch'
      return `Searching web for \`${truncate(query, 30)}\``
    }
    case 'WebFetch': {
      const url = typeof parsed.url === 'string' ? parsed.url : ''
      if (!url) return 'WebFetch'
      return `Fetching \`${truncate(url, 40)}\``
    }
    case 'Agent': {
      const prompt = typeof parsed.prompt === 'string'
        ? parsed.prompt
        : typeof parsed.description === 'string'
          ? parsed.description
          : ''
      if (!prompt) return 'Agent'
      return `Agent: ${truncate(prompt, 40)}`
    }
    default:
      return toolName
  }
}

/**
 * Map toolName to the operation type for file entries.
 */
function toolNameToOperation(toolName: string): FileEntry['operations'][number] | null {
  switch (toolName) {
    case 'Read': return 'read'
    case 'Edit': return 'edited'
    case 'Write': return 'created'
    case 'Grep': return 'searched'
    case 'Glob': return 'searched'
    case 'Bash': return 'ran'
    default: return null
  }
}

/**
 * Extract all files referenced in tool messages, deduplicating by path
 * and collecting all operations performed on each file.
 */
export function extractFilesFromTools(messages: Message[]): FileEntry[] {
  const fileMap = new Map<string, Set<FileEntry['operations'][number]>>()

  for (const msg of messages) {
    if (msg.role !== 'tool' || !msg.toolName || !msg.toolInput) continue

    const parsed = safeParse(msg.toolInput)
    if (!parsed) continue

    const toolName = msg.toolName
    const operation = toolNameToOperation(toolName)
    if (!operation) continue

    // Extract file path from known tool shapes
    let fp: string | null = null

    if (toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') {
      const raw = parsed.file_path ?? parsed.path
      if (typeof raw === 'string' && raw) fp = raw
    } else if (toolName === 'Grep' || toolName === 'Glob') {
      const raw = parsed.path
      if (typeof raw === 'string' && raw) fp = raw
    }

    if (!fp) continue

    const existing = fileMap.get(fp)
    if (existing) {
      existing.add(operation)
    } else {
      fileMap.set(fp, new Set([operation]))
    }
  }

  const entries: FileEntry[] = []
  for (const [path, ops] of fileMap) {
    entries.push({ path, operations: Array.from(ops) })
  }

  return entries
}
