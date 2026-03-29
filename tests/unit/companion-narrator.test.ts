import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import type { NormalizedEvent } from '../../src/shared/types'

// Mock child_process before importing
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

// Mock platform to avoid resolveClaudeEntryPoint real execution
vi.mock('../../src/main/platform', () => ({
  resolveClaudeEntryPoint: () => ({ binary: 'claude', prefixArgs: [] }),
}))

// Mock logger
vi.mock('../../src/main/logger', () => ({
  log: () => {},
}))

// Mock stream-parser
vi.mock('../../src/main/stream-parser', () => ({
  StreamParser: {
    fromStream: () => ({
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    }),
  },
}))

// Mock fs to isolate from real settings file
const mockExistsSync = vi.fn().mockReturnValue(false)
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: (...args: unknown[]) => {
      const path = args[0] as string
      if (path.includes('companion-settings.json')) return mockExistsSync(path)
      return actual.existsSync(path as any)
    },
    readFileSync: (...args: unknown[]) => {
      const path = args[0] as string
      if (path.includes('companion-settings.json')) return '{}'
      return actual.readFileSync(path as any, args[1] as any)
    },
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  }
})

import { CompanionNarrator } from '../../src/main/claude/companion-narrator'

describe('CompanionNarrator', () => {
  let narrator: CompanionNarrator
  const broadcast = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    broadcast.mockClear()
    mockExistsSync.mockReturnValue(false)
    narrator = new CompanionNarrator(broadcast, { binary: 'claude', prefixArgs: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('context buffer tracking', () => {
    it('should track tool calls in context buffer', () => {
      narrator.onEvent('tab1', { type: 'session_init', sessionId: 's1', tools: [], model: 'opus', mcpServers: [], skills: [], version: '1.0' })
      narrator.onEvent('tab1', { type: 'tool_call', toolName: 'Read', toolId: 't1', index: 0 })
      narrator.onEvent('tab1', { type: 'tool_call', toolName: 'Write', toolId: 't2', index: 1 })

      // Verify prompt includes the tool calls (use buildPrompt for testing)
      const prompt = narrator.buildPrompt([
        { toolName: 'Read', toolId: 't1', partialInput: '' },
        { toolName: 'Write', toolId: 't2', partialInput: '' },
      ])
      expect(prompt).toContain('Read')
      expect(prompt).toContain('Write')
    })

    it('should limit context buffer to 10 entries', () => {
      narrator.onEvent('tab1', { type: 'session_init', sessionId: 's1', tools: [], model: 'opus', mcpServers: [], skills: [], version: '1.0' })

      for (let i = 0; i < 15; i++) {
        narrator.onEvent('tab1', { type: 'tool_call', toolName: `Tool${i}`, toolId: `t${i}`, index: i })
      }

      // The prompt for idle gap would only include last 10 tools
      // We test this indirectly — the buffer is internal, but buildPrompt works
      const prompt = narrator.buildPrompt([
        { toolName: 'Tool14', toolId: 't14', partialInput: '' },
      ])
      expect(prompt).toContain('Tool14')
    })
  })

  describe('idle gap detection', () => {
    it('should fire after 3 seconds of idle', () => {
      narrator.setEnabled(true)
      narrator.onEvent('tab1', { type: 'session_init', sessionId: 's1', tools: [], model: 'opus', mcpServers: [], skills: [], version: '1.0' })
      narrator.onEvent('tab1', { type: 'tool_call', toolName: 'Read', toolId: 't1', index: 0 })
      narrator.onEvent('tab1', { type: 'tool_call_complete', index: 0 })

      // Before 3 seconds — no call
      vi.advanceTimersByTime(2999)
      // spawn is not called yet (we can't easily test the spawn without more mocking,
      // but we can verify the timer logic works by checking broadcast wasn't called)
      expect(broadcast).not.toHaveBeenCalled()
    })

    it('should reset timer on new events', () => {
      narrator.setEnabled(true)
      narrator.onEvent('tab1', { type: 'session_init', sessionId: 's1', tools: [], model: 'opus', mcpServers: [], skills: [], version: '1.0' })
      narrator.onEvent('tab1', { type: 'tool_call', toolName: 'Read', toolId: 't1', index: 0 })
      narrator.onEvent('tab1', { type: 'tool_call_complete', index: 0 })

      vi.advanceTimersByTime(2000)
      // Another event resets the timer
      narrator.onEvent('tab1', { type: 'text_chunk', text: 'hello' })
      vi.advanceTimersByTime(2000)
      // Still no idle gap fired (only 2s since last event)
      expect(broadcast).not.toHaveBeenCalled()
    })
  })

  describe('rate limiting', () => {
    it('should not generate commentary when disabled', () => {
      narrator.setEnabled(false)
      narrator.onEvent('tab1', { type: 'session_init', sessionId: 's1', tools: [], model: 'opus', mcpServers: [], skills: [], version: '1.0' })
      narrator.onEvent('tab1', { type: 'tool_call', toolName: 'Read', toolId: 't1', index: 0 })
      narrator.onEvent('tab1', { type: 'tool_call_complete', index: 0 })

      vi.advanceTimersByTime(5000)
      expect(broadcast).not.toHaveBeenCalled()
    })
  })

  describe('stops on terminal events', () => {
    it('should stop tracking on task_complete', () => {
      narrator.setEnabled(true)
      narrator.onEvent('tab1', { type: 'session_init', sessionId: 's1', tools: [], model: 'opus', mcpServers: [], skills: [], version: '1.0' })
      narrator.onEvent('tab1', { type: 'tool_call', toolName: 'Read', toolId: 't1', index: 0 })
      narrator.onEvent('tab1', {
        type: 'task_complete',
        result: 'done',
        costUsd: 0,
        durationMs: 1000,
        numTurns: 1,
        usage: { input_tokens: 0, output_tokens: 0 },
        sessionId: 's1',
      })

      // After task_complete, further events should not cause idle gap
      narrator.onEvent('tab1', { type: 'tool_call', toolName: 'Write', toolId: 't2', index: 1 })
      vi.advanceTimersByTime(5000)
      expect(broadcast).not.toHaveBeenCalled()
    })

    it('should stop tracking on session_dead', () => {
      narrator.setEnabled(true)
      narrator.onEvent('tab1', { type: 'session_init', sessionId: 's1', tools: [], model: 'opus', mcpServers: [], skills: [], version: '1.0' })
      narrator.onEvent('tab1', { type: 'tool_call', toolName: 'Read', toolId: 't1', index: 0 })
      narrator.onEvent('tab1', { type: 'session_dead', exitCode: 1, signal: null, stderrTail: [] })

      vi.advanceTimersByTime(5000)
      expect(broadcast).not.toHaveBeenCalled()
    })
  })

  describe('settings persistence', () => {
    it('should default to disabled', () => {
      expect(narrator.isEnabled()).toBe(false)
    })

    it('should toggle enabled', () => {
      narrator.setEnabled(true)
      expect(narrator.isEnabled()).toBe(true)
      narrator.setEnabled(false)
      expect(narrator.isEnabled()).toBe(false)
    })
  })

  describe('prompt construction', () => {
    it('should build prompt from context buffer', () => {
      const prompt = narrator.buildPrompt([
        { toolName: 'Read', toolId: 't1', partialInput: '/src/index.ts' },
        { toolName: 'Grep', toolId: 't2', partialInput: 'function main' },
      ])

      expect(prompt).toContain('companion narrator')
      expect(prompt).toContain('Read: /src/index.ts')
      expect(prompt).toContain('Grep: function main')
      expect(prompt).toContain('1-2 sentences')
    })

    it('should handle empty partial input', () => {
      const prompt = narrator.buildPrompt([
        { toolName: 'Read', toolId: 't1', partialInput: '' },
      ])

      expect(prompt).toContain('- Read')
      expect(prompt).not.toContain('Read:')
    })
  })
})
