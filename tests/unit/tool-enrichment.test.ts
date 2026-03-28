import { describe, expect, it } from 'vitest'
import { getEnrichedToolLabel, extractFilesFromTools } from '../../src/shared/tool-enrichment'
import type { Message } from '../../src/shared/types'

function makeMsg(overrides: Partial<Message> & Pick<Message, 'role' | 'content'>): Message {
  return {
    id: overrides.id || crypto.randomUUID(),
    timestamp: overrides.timestamp ?? Date.now(),
    ...overrides,
  }
}

describe('getEnrichedToolLabel', () => {
  it('returns "Reading `filename`" for Read tool with file_path', () => {
    const input = JSON.stringify({ file_path: '/home/user/src/main/index.ts' })
    expect(getEnrichedToolLabel('Read', input)).toBe('Reading `index.ts`')
  })

  it('returns "Reading `filename`" for Read tool with path field', () => {
    const input = JSON.stringify({ path: '/tmp/foo.txt' })
    expect(getEnrichedToolLabel('Read', input)).toBe('Reading `foo.txt`')
  })

  it('returns "Editing `filename` (+N −M)" for Edit tool with diff stats', () => {
    const input = JSON.stringify({
      file_path: '/src/package.json',
      old_string: 'line1\nline2',
      new_string: 'line1\nline2\nline3\nline4',
    })
    const result = getEnrichedToolLabel('Edit', input)
    expect(result).toBe('Editing `package.json` (+4 \u22122)')
  })

  it('returns "Editing `filename`" for Edit with no diff strings', () => {
    const input = JSON.stringify({ file_path: '/src/app.ts' })
    expect(getEnrichedToolLabel('Edit', input)).toBe('Editing `app.ts`')
  })

  it('returns "Running `command`" for Bash tool', () => {
    const input = JSON.stringify({ command: 'npm test' })
    expect(getEnrichedToolLabel('Bash', input)).toBe('Running `npm test`')
  })

  it('truncates long Bash commands', () => {
    const longCmd = 'a'.repeat(50)
    const input = JSON.stringify({ command: longCmd })
    const result = getEnrichedToolLabel('Bash', input)
    expect(result.length).toBeLessThan(60)
    expect(result).toContain('\u2026')
  })

  it('returns "Searching for `pattern` in path" for Grep tool', () => {
    const input = JSON.stringify({ pattern: 'useColors', path: 'src/' })
    expect(getEnrichedToolLabel('Grep', input)).toBe('Searching for `useColors` in src/')
  })

  it('returns "Searching for `pattern`" for Grep without path', () => {
    const input = JSON.stringify({ pattern: 'useColors' })
    expect(getEnrichedToolLabel('Grep', input)).toBe('Searching for `useColors`')
  })

  it('returns "Finding files `pattern`" for Glob tool', () => {
    const input = JSON.stringify({ pattern: '**/*.test.ts' })
    expect(getEnrichedToolLabel('Glob', input)).toBe('Finding files `**/*.test.ts`')
  })

  it('returns "Creating `filename`" for Write tool', () => {
    const input = JSON.stringify({ file_path: '/src/new-file.ts', content: 'hello' })
    expect(getEnrichedToolLabel('Write', input)).toBe('Creating `new-file.ts`')
  })

  it('gracefully falls back on malformed JSON', () => {
    expect(getEnrichedToolLabel('Read', '{not valid json')).toBe('Read')
  })

  it('gracefully falls back on null/undefined input', () => {
    expect(getEnrichedToolLabel('Read')).toBe('Read')
    expect(getEnrichedToolLabel('Read', undefined)).toBe('Read')
  })

  it('gracefully falls back on empty string input', () => {
    expect(getEnrichedToolLabel('Bash', '')).toBe('Bash')
  })

  it('returns toolName for unknown tools', () => {
    const input = JSON.stringify({ foo: 'bar' })
    expect(getEnrichedToolLabel('CustomTool', input)).toBe('CustomTool')
  })
})

describe('extractFilesFromTools', () => {
  it('extracts files from Read, Edit, Write tools', () => {
    const messages: Message[] = [
      makeMsg({ role: 'tool', content: '', toolName: 'Read', toolInput: JSON.stringify({ file_path: '/src/a.ts' }) }),
      makeMsg({ role: 'tool', content: '', toolName: 'Edit', toolInput: JSON.stringify({ file_path: '/src/b.ts', old_string: 'x', new_string: 'y' }) }),
      makeMsg({ role: 'tool', content: '', toolName: 'Write', toolInput: JSON.stringify({ file_path: '/src/c.ts', content: 'new' }) }),
    ]

    const files = extractFilesFromTools(messages)
    expect(files).toHaveLength(3)
    expect(files.find((f) => f.path === '/src/a.ts')?.operations).toEqual(['read'])
    expect(files.find((f) => f.path === '/src/b.ts')?.operations).toEqual(['edited'])
    expect(files.find((f) => f.path === '/src/c.ts')?.operations).toEqual(['created'])
  })

  it('deduplicates files and merges operations', () => {
    const messages: Message[] = [
      makeMsg({ role: 'tool', content: '', toolName: 'Read', toolInput: JSON.stringify({ file_path: '/src/a.ts' }) }),
      makeMsg({ role: 'tool', content: '', toolName: 'Edit', toolInput: JSON.stringify({ file_path: '/src/a.ts', old_string: 'x', new_string: 'y' }) }),
    ]

    const files = extractFilesFromTools(messages)
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('/src/a.ts')
    expect(files[0].operations).toContain('read')
    expect(files[0].operations).toContain('edited')
  })

  it('ignores non-tool messages', () => {
    const messages: Message[] = [
      makeMsg({ role: 'user', content: 'hello' }),
      makeMsg({ role: 'assistant', content: 'world' }),
      makeMsg({ role: 'tool', content: '', toolName: 'Read', toolInput: JSON.stringify({ file_path: '/src/a.ts' }) }),
    ]

    const files = extractFilesFromTools(messages)
    expect(files).toHaveLength(1)
  })

  it('handles malformed toolInput gracefully', () => {
    const messages: Message[] = [
      makeMsg({ role: 'tool', content: '', toolName: 'Read', toolInput: 'not json' }),
      makeMsg({ role: 'tool', content: '', toolName: 'Read', toolInput: JSON.stringify({ file_path: '/src/a.ts' }) }),
    ]

    const files = extractFilesFromTools(messages)
    expect(files).toHaveLength(1)
  })

  it('returns empty array for no tool messages', () => {
    expect(extractFilesFromTools([])).toEqual([])
  })

  it('handles Grep with path', () => {
    const messages: Message[] = [
      makeMsg({ role: 'tool', content: '', toolName: 'Grep', toolInput: JSON.stringify({ pattern: 'foo', path: 'src/utils' }) }),
    ]

    const files = extractFilesFromTools(messages)
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('src/utils')
    expect(files[0].operations).toEqual(['searched'])
  })
})
