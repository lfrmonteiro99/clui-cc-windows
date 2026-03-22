import { describe, it, expect } from 'vitest'
import { generateHandoffDocument, formatHandoffAsPrompt } from '../../src/shared/session-handoff'
import type { Message } from '../../src/shared/types'

function msg(overrides: Partial<Message>): Message {
  return {
    id: 'test-' + Math.random().toString(36).slice(2, 8),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('session-handoff', () => {
  describe('generateHandoffDocument', () => {
    it('extracts goal from first user message', () => {
      const messages = [
        msg({ role: 'user', content: 'Fix the authentication bug in login handler.' }),
        msg({ role: 'assistant', content: 'I will fix the auth bug.' }),
      ]
      const doc = generateHandoffDocument(messages)
      expect(doc.goal).toContain('Fix the authentication bug')
    })

    it('returns unknown goal when no user messages', () => {
      const doc = generateHandoffDocument([])
      expect(doc.goal).toBe('Unknown goal')
    })

    it('truncates long goals', () => {
      const longText = 'Fix '.repeat(100)
      const messages = [msg({ role: 'user', content: longText })]
      const doc = generateHandoffDocument(messages)
      expect(doc.goal.length).toBeLessThanOrEqual(153) // 150 + ...
    })

    it('extracts completed steps from tool messages', () => {
      const messages = [
        msg({ role: 'user', content: 'Fix bug' }),
        msg({ role: 'tool', toolName: 'Read', toolInput: '{"file_path":"src/auth.ts"}', toolStatus: 'completed', content: '' }),
        msg({ role: 'tool', toolName: 'Edit', toolInput: '{"file_path":"src/auth.ts"}', toolStatus: 'completed', content: '' }),
      ]
      const doc = generateHandoffDocument(messages)
      expect(doc.completedSteps.length).toBe(2)
      expect(doc.completedSteps[0]).toContain('Read src/auth.ts')
    })

    it('extracts modified file paths', () => {
      const messages = [
        msg({ role: 'tool', toolName: 'Edit', toolInput: '{"file_path":"src/a.ts"}', toolStatus: 'completed', content: '' }),
        msg({ role: 'tool', toolName: 'Write', toolInput: '{"file_path":"src/b.ts"}', toolStatus: 'completed', content: '' }),
        msg({ role: 'tool', toolName: 'Read', toolInput: '{"file_path":"src/c.ts"}', toolStatus: 'completed', content: '' }),
      ]
      const doc = generateHandoffDocument(messages)
      expect(doc.fileStates).toContain('src/a.ts')
      expect(doc.fileStates).toContain('src/b.ts')
      expect(doc.fileStates).not.toContain('src/c.ts') // Read doesn't modify
    })

    it('extracts open decisions from questions', () => {
      const messages = [
        msg({ role: 'assistant', content: 'Should we use JWT or session cookies for authentication?' }),
      ]
      const doc = generateHandoffDocument(messages)
      expect(doc.openDecisions.length).toBe(1)
      expect(doc.openDecisions[0]).toContain('JWT or session cookies')
    })

    it('extracts next steps from last assistant message', () => {
      const messages = [
        msg({ role: 'assistant', content: 'Step 1 done.' }),
        msg({ role: 'assistant', content: 'Now we need to add tests for the new handler.' }),
      ]
      const doc = generateHandoffDocument(messages)
      expect(doc.nextSteps).toContain('add tests')
    })
  })

  describe('formatHandoffAsPrompt', () => {
    it('formats a complete handoff document', () => {
      const doc = {
        goal: 'Fix authentication bug',
        completedSteps: ['Read src/auth.ts', 'Edit src/auth.ts'],
        openDecisions: ['Use JWT or sessions?'],
        fileStates: ['src/auth.ts'],
        nextSteps: 'Add tests for the fix.',
      }
      const prompt = formatHandoffAsPrompt(doc)
      expect(prompt).toContain('Continue this session')
      expect(prompt).toContain('Fix authentication bug')
      expect(prompt).toContain('Read src/auth.ts')
      expect(prompt).toContain('src/auth.ts')
      expect(prompt).toContain('JWT or sessions')
      expect(prompt).toContain('Add tests')
    })

    it('omits empty sections', () => {
      const doc = {
        goal: 'Simple task',
        completedSteps: [],
        openDecisions: [],
        fileStates: [],
        nextSteps: 'Continue.',
      }
      const prompt = formatHandoffAsPrompt(doc)
      expect(prompt).not.toContain('Completed Steps')
      expect(prompt).not.toContain('Files Modified')
      expect(prompt).not.toContain('Open Questions')
    })
  })
})
