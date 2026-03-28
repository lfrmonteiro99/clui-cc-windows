import { describe, it, expect } from 'vitest'
import { extractCodeBlocks, extractFilesTouched, countToolCalls } from '../../src/shared/completion-utils'
import type { Message } from '../../src/shared/types'

function makeMsg(overrides: Partial<Message> & Pick<Message, 'role' | 'content'>): Message {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('extractCodeBlocks', () => {
  it('extracts single code block from assistant message', () => {
    const messages = [
      makeMsg({
        role: 'assistant',
        content: 'Here is the code:\n```ts\nconst x = 1\n```\nDone.',
      }),
    ]
    const blocks = extractCodeBlocks(messages)
    expect(blocks).toEqual(['const x = 1'])
  })

  it('extracts multiple code blocks from one message', () => {
    const messages = [
      makeMsg({
        role: 'assistant',
        content: '```js\nalert("hi")\n```\nAnd:\n```python\nprint("hi")\n```',
      }),
    ]
    const blocks = extractCodeBlocks(messages)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toBe('alert("hi")')
    expect(blocks[1]).toBe('print("hi")')
  })

  it('extracts code blocks across multiple assistant messages', () => {
    const messages = [
      makeMsg({ role: 'assistant', content: '```\nblock1\n```' }),
      makeMsg({ role: 'user', content: 'thanks' }),
      makeMsg({ role: 'assistant', content: '```\nblock2\n```' }),
    ]
    const blocks = extractCodeBlocks(messages)
    expect(blocks).toEqual(['block1', 'block2'])
  })

  it('ignores user and tool messages', () => {
    const messages = [
      makeMsg({ role: 'user', content: '```\nuser code\n```' }),
      makeMsg({ role: 'tool', content: '```\ntool code\n```' }),
    ]
    expect(extractCodeBlocks(messages)).toEqual([])
  })

  it('returns empty array when no code blocks exist', () => {
    const messages = [
      makeMsg({ role: 'assistant', content: 'No code here.' }),
    ]
    expect(extractCodeBlocks(messages)).toEqual([])
  })

  it('returns empty array for empty messages', () => {
    expect(extractCodeBlocks([])).toEqual([])
  })

  it('skips empty code blocks', () => {
    const messages = [
      makeMsg({ role: 'assistant', content: '```\n```\nSome text.\n```ts\nreal code\n```' }),
    ]
    const blocks = extractCodeBlocks(messages)
    expect(blocks).toEqual(['real code'])
  })
})

describe('extractFilesTouched', () => {
  it('extracts file_path from tool input JSON', () => {
    const messages = [
      makeMsg({
        role: 'tool',
        content: 'file contents',
        toolName: 'Read',
        toolInput: '{"file_path":"/src/app.ts"}',
      }),
    ]
    const files = extractFilesTouched(messages)
    expect(files).toContain('/src/app.ts')
  })

  it('extracts path from tool input JSON', () => {
    const messages = [
      makeMsg({
        role: 'tool',
        content: '',
        toolName: 'Glob',
        toolInput: '{"path":"/src/utils"}',
      }),
    ]
    const files = extractFilesTouched(messages)
    expect(files).toContain('/src/utils')
  })

  it('extracts paths from content via regex', () => {
    const messages = [
      makeMsg({
        role: 'tool',
        content: 'Modified /home/user/project/index.ts successfully',
        toolName: 'Edit',
        toolInput: '{}',
      }),
    ]
    const files = extractFilesTouched(messages)
    expect(files).toContain('/home/user/project/index.ts')
  })

  it('extracts Windows paths from malformed toolInput', () => {
    const messages = [
      makeMsg({
        role: 'tool',
        content: '',
        toolName: 'Read',
        toolInput: 'C:/Users/dev/project/main.ts',
      }),
    ]
    const files = extractFilesTouched(messages)
    expect(files).toContain('C:/Users/dev/project/main.ts')
  })

  it('deduplicates paths', () => {
    const messages = [
      makeMsg({
        role: 'tool',
        content: '/src/app.ts',
        toolName: 'Read',
        toolInput: '{"file_path":"/src/app.ts"}',
      }),
    ]
    const files = extractFilesTouched(messages)
    expect(files.filter((f) => f === '/src/app.ts')).toHaveLength(1)
  })

  it('ignores non-tool messages', () => {
    const messages = [
      makeMsg({ role: 'assistant', content: 'I edited /src/app.ts' }),
      makeMsg({ role: 'user', content: 'Check /src/app.ts' }),
    ]
    expect(extractFilesTouched(messages)).toEqual([])
  })

  it('returns empty for empty messages', () => {
    expect(extractFilesTouched([])).toEqual([])
  })

  it('handles tool messages with no toolInput', () => {
    const messages = [
      makeMsg({
        role: 'tool',
        content: 'some output from /var/log/app.log',
      }),
    ]
    const files = extractFilesTouched(messages)
    expect(files).toContain('/var/log/app.log')
  })
})

describe('countToolCalls', () => {
  it('counts tool messages', () => {
    const messages = [
      makeMsg({ role: 'user', content: 'hi' }),
      makeMsg({ role: 'tool', content: 'output1' }),
      makeMsg({ role: 'assistant', content: 'response' }),
      makeMsg({ role: 'tool', content: 'output2' }),
      makeMsg({ role: 'tool', content: 'output3' }),
    ]
    expect(countToolCalls(messages)).toBe(3)
  })

  it('returns 0 when no tool messages exist', () => {
    const messages = [
      makeMsg({ role: 'user', content: 'hi' }),
      makeMsg({ role: 'assistant', content: 'hello' }),
    ]
    expect(countToolCalls(messages)).toBe(0)
  })

  it('returns 0 for empty messages', () => {
    expect(countToolCalls([])).toBe(0)
  })
})
