import { describe, it, expect } from 'vitest'
import { analyzeForPruning } from '../../src/shared/context-pruner'
import type { Message } from '../../src/shared/types'

function msg(overrides: Partial<Message> & { id: string }): Message {
  return {
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('context-pruner', () => {
  describe('analyzeForPruning', () => {
    it('returns empty actions for empty messages', () => {
      const result = analyzeForPruning([])
      expect(result.actions).toHaveLength(0)
      expect(result.prunedCount).toBe(0)
      expect(result.savedTokens).toBe(0)
    })

    it('detects redundant reads superseded by writes', () => {
      const messages: Message[] = [
        msg({ id: '1', role: 'tool', toolName: 'Read', toolInput: '{"file_path":"src/a.ts"}', toolStatus: 'completed', content: 'file contents...' }),
        msg({ id: '2', role: 'tool', toolName: 'Edit', toolInput: '{"file_path":"src/a.ts"}', toolStatus: 'completed', content: 'edited' }),
      ]
      const result = analyzeForPruning(messages)
      const readAction = result.actions.find((a) => a.reason.includes('Read of src/a.ts'))
      expect(readAction).toBeDefined()
      expect(readAction!.messageIds).toContain('1')
    })

    it('detects duplicate reads of the same file', () => {
      const messages: Message[] = [
        msg({ id: '1', role: 'tool', toolName: 'Read', toolInput: '{"file_path":"src/b.ts"}', toolStatus: 'completed', content: 'v1' }),
        msg({ id: '2', role: 'user', content: 'ok' }),
        msg({ id: '3', role: 'tool', toolName: 'Read', toolInput: '{"file_path":"src/b.ts"}', toolStatus: 'completed', content: 'v2' }),
      ]
      const result = analyzeForPruning(messages)
      const dupAction = result.actions.find((a) => a.reason.includes('Duplicate reads'))
      expect(dupAction).toBeDefined()
      expect(dupAction!.messageIds).toContain('1')
      expect(dupAction!.messageIds).not.toContain('3') // latest kept
    })

    it('does not flag single reads as duplicates', () => {
      const messages: Message[] = [
        msg({ id: '1', role: 'tool', toolName: 'Read', toolInput: '{"file_path":"src/c.ts"}', toolStatus: 'completed', content: 'content' }),
      ]
      const result = analyzeForPruning(messages)
      const dupAction = result.actions.find((a) => a.reason.includes('Duplicate reads'))
      expect(dupAction).toBeUndefined()
    })

    it('detects correction loops', () => {
      const messages: Message[] = [
        msg({ id: '1', role: 'assistant', content: 'Here is the fix using npm install' }),
        msg({ id: '2', role: 'user', content: 'No, we use pnpm instead of npm' }),
        msg({ id: '3', role: 'assistant', content: 'Here is the fix using pnpm install' }),
      ]
      const result = analyzeForPruning(messages)
      const corrAction = result.actions.find((a) => a.reason.includes('Correction loop'))
      expect(corrAction).toBeDefined()
      expect(corrAction!.messageIds).toContain('1')
      expect(corrAction!.messageIds).toContain('2')
    })

    it('detects old tool outputs', () => {
      const messages: Message[] = []
      // Create 40 messages, first 10 are old tools
      for (let i = 0; i < 10; i++) {
        messages.push(msg({ id: `tool-${i}`, role: 'tool', toolName: 'Read', toolStatus: 'completed', content: 'old content' }))
      }
      for (let i = 10; i < 40; i++) {
        messages.push(msg({ id: `msg-${i}`, role: 'assistant', content: `response ${i}` }))
      }
      const result = analyzeForPruning(messages)
      const oldAction = result.actions.find((a) => a.reason.includes('old tool outputs'))
      expect(oldAction).toBeDefined()
      expect(oldAction!.messageIds.length).toBeGreaterThan(0)
    })

    it('estimates token savings', () => {
      const messages: Message[] = [
        msg({ id: '1', role: 'tool', toolName: 'Read', toolInput: '{"file_path":"src/x.ts"}', toolStatus: 'completed', content: 'A'.repeat(400) }),
        msg({ id: '2', role: 'tool', toolName: 'Edit', toolInput: '{"file_path":"src/x.ts"}', toolStatus: 'completed', content: 'edited' }),
      ]
      const result = analyzeForPruning(messages)
      expect(result.savedTokens).toBeGreaterThan(0)
    })

    it('reports correct original and pruned counts', () => {
      const messages: Message[] = [
        msg({ id: '1', role: 'tool', toolName: 'Read', toolInput: '{"file_path":"a.ts"}', toolStatus: 'completed', content: 'x' }),
        msg({ id: '2', role: 'tool', toolName: 'Read', toolInput: '{"file_path":"a.ts"}', toolStatus: 'completed', content: 'y' }),
        msg({ id: '3', role: 'tool', toolName: 'Write', toolInput: '{"file_path":"a.ts"}', toolStatus: 'completed', content: 'z' }),
      ]
      const result = analyzeForPruning(messages)
      expect(result.originalCount).toBe(3)
      expect(result.prunedCount).toBeGreaterThan(0)
    })
  })
})
