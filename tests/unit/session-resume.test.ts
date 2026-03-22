import { describe, expect, it } from 'vitest'
import { generateResumeBrief, RESUME_INACTIVITY_MS, CATCH_ME_UP_PROMPT } from '../../src/shared/session-resume'
import type { Message, TabStatus } from '../../src/shared/types'

function msg(overrides: Partial<Message> & Pick<Message, 'role' | 'content'>): Message {
  return {
    id: overrides.id || crypto.randomUUID(),
    timestamp: overrides.timestamp ?? Date.now(),
    ...overrides,
  }
}

describe('generateResumeBrief', () => {
  it('returns null when messages array is empty', () => {
    expect(generateResumeBrief([], 'idle')).toBeNull()
  })

  it('extracts last task from last assistant message', () => {
    const messages: Message[] = [
      msg({ role: 'user', content: 'Fix the bug' }),
      msg({ role: 'assistant', content: 'I fixed the authentication bug in the login handler.' }),
    ]
    const brief = generateResumeBrief(messages, 'completed')
    expect(brief).not.toBeNull()
    expect(brief!.lastTask).toBe('I fixed the authentication bug in the login handler.')
  })

  it('truncates last task to ~100 chars when no sentence break', () => {
    const longText = 'A'.repeat(150)
    const messages: Message[] = [
      msg({ role: 'assistant', content: longText }),
    ]
    const brief = generateResumeBrief(messages, 'idle')
    expect(brief!.lastTask.length).toBeLessThanOrEqual(100)
    expect(brief!.lastTask).toContain('...')
  })

  it('extracts first sentence when it fits within 100 chars', () => {
    const messages: Message[] = [
      msg({ role: 'assistant', content: 'I updated the tests. Then I also refactored the service layer significantly.' }),
    ]
    const brief = generateResumeBrief(messages, 'completed')
    expect(brief!.lastTask).toBe('I updated the tests.')
  })

  it('falls back to "No task information available" when no assistant messages', () => {
    const messages: Message[] = [
      msg({ role: 'user', content: 'Do something' }),
      msg({ role: 'tool', content: '', toolName: 'Read', toolInput: '{"file_path":"/src/app.ts"}' }),
    ]
    const brief = generateResumeBrief(messages, 'idle')
    expect(brief!.lastTask).toBe('No task information available')
  })

  it('extracts file paths from tool messages with file_path input', () => {
    const messages: Message[] = [
      msg({ role: 'user', content: 'Fix bugs' }),
      msg({ role: 'tool', content: '', toolName: 'Read', toolInput: '{"file_path":"/src/app.ts"}' }),
      msg({ role: 'tool', content: '', toolName: 'Edit', toolInput: '{"file_path":"/src/utils.ts","old_string":"a","new_string":"b"}' }),
      msg({ role: 'assistant', content: 'Done.' }),
    ]
    const brief = generateResumeBrief(messages, 'completed')
    expect(brief!.filesTouched).toContain('/src/app.ts')
    expect(brief!.filesTouched).toContain('/src/utils.ts')
    expect(brief!.filesTouched).toHaveLength(2)
  })

  it('extracts file paths from tool content via regex', () => {
    const messages: Message[] = [
      msg({ role: 'tool', content: 'Found results in /home/user/project/main.py and /etc/config.yml', toolName: 'Grep' }),
    ]
    const brief = generateResumeBrief(messages, 'idle')
    expect(brief!.filesTouched).toContain('/home/user/project/main.py')
    expect(brief!.filesTouched).toContain('/etc/config.yml')
  })

  it('extracts Windows-style file paths', () => {
    const messages: Message[] = [
      msg({ role: 'tool', content: '', toolName: 'Read', toolInput: '{"file_path":"C:/Users/dev/project/src/index.ts"}' }),
    ]
    const brief = generateResumeBrief(messages, 'idle')
    expect(brief!.filesTouched).toContain('C:/Users/dev/project/src/index.ts')
  })

  it('deduplicates file paths', () => {
    const messages: Message[] = [
      msg({ role: 'tool', content: '', toolName: 'Read', toolInput: '{"file_path":"/src/app.ts"}' }),
      msg({ role: 'tool', content: '', toolName: 'Edit', toolInput: '{"file_path":"/src/app.ts","old_string":"x","new_string":"y"}' }),
    ]
    const brief = generateResumeBrief(messages, 'idle')
    expect(brief!.filesTouched).toHaveLength(1)
    expect(brief!.filesTouched[0]).toBe('/src/app.ts')
  })

  it('maps completed tab status to completed', () => {
    const messages: Message[] = [msg({ role: 'assistant', content: 'Done' })]
    expect(generateResumeBrief(messages, 'completed')!.status).toBe('completed')
  })

  it('maps running tab status to in_progress', () => {
    const messages: Message[] = [msg({ role: 'assistant', content: 'Working' })]
    expect(generateResumeBrief(messages, 'running')!.status).toBe('in_progress')
  })

  it('maps connecting tab status to in_progress', () => {
    const messages: Message[] = [msg({ role: 'assistant', content: 'Starting' })]
    expect(generateResumeBrief(messages, 'connecting')!.status).toBe('in_progress')
  })

  it('maps idle/failed/dead tab status to interrupted', () => {
    const messages: Message[] = [msg({ role: 'assistant', content: 'Task' })]
    const statuses: TabStatus[] = ['idle', 'failed', 'dead']
    for (const status of statuses) {
      expect(generateResumeBrief(messages, status)!.status).toBe('interrupted')
    }
  })

  it('reports correct message count', () => {
    const messages: Message[] = [
      msg({ role: 'user', content: 'a' }),
      msg({ role: 'assistant', content: 'b' }),
      msg({ role: 'tool', content: 'c', toolName: 'Read' }),
    ]
    const brief = generateResumeBrief(messages, 'completed')
    expect(brief!.messageCount).toBe(3)
  })

  it('reports lastActivityAt from the most recent message', () => {
    const messages: Message[] = [
      msg({ role: 'user', content: 'a', timestamp: 1000 }),
      msg({ role: 'assistant', content: 'b', timestamp: 2000 }),
    ]
    const brief = generateResumeBrief(messages, 'completed')
    expect(brief!.lastActivityAt).toBe(2000)
  })

  it('handles tool messages with invalid JSON input gracefully', () => {
    const messages: Message[] = [
      msg({ role: 'tool', content: 'partial result', toolName: 'Bash', toolInput: '{"command":"ls /src/app.ts' }),
      msg({ role: 'assistant', content: 'Done.' }),
    ]
    const brief = generateResumeBrief(messages, 'completed')
    // Should not throw — paths may or may not be extracted from partial JSON via regex
    expect(brief).not.toBeNull()
    expect(brief!.lastTask).toBe('Done.')
  })
})

describe('constants', () => {
  it('RESUME_INACTIVITY_MS is 10 minutes', () => {
    expect(RESUME_INACTIVITY_MS).toBe(600_000)
  })

  it('CATCH_ME_UP_PROMPT is a non-empty string', () => {
    expect(CATCH_ME_UP_PROMPT.length).toBeGreaterThan(0)
  })
})
