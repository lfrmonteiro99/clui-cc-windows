import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs'
import type { Message, SessionDigest } from '../../src/shared/types'

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

import { SessionDigestManager } from '../../src/main/claude/session-digest'

describe('SessionDigestManager', () => {
  const testDir = join(tmpdir(), `clui-session-digest-${Date.now()}`)
  let manager: SessionDigestManager
  const broadcast = vi.fn()

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
    manager = new SessionDigestManager(broadcast)
    // Override storage path for testing
    ;(manager as any).storagePath = join(testDir, 'session-digests.json')
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  describe('settings', () => {
    it('defaults to disabled', () => {
      expect(manager.isEnabled()).toBe(false)
      expect(manager.getSettings().enabled).toBe(false)
    })

    it('persists enabled setting', () => {
      manager.setSettings({ enabled: true })
      expect(manager.isEnabled()).toBe(true)

      // Re-read from disk
      const manager2 = new SessionDigestManager(broadcast)
      ;(manager2 as any).storagePath = join(testDir, 'session-digests.json')
      expect(manager2.isEnabled()).toBe(true)
    })

    it('can toggle back to disabled', () => {
      manager.setSettings({ enabled: true })
      manager.setSettings({ enabled: false })
      expect(manager.isEnabled()).toBe(false)
    })
  })

  describe('message extraction', () => {
    it('extracts last 5 assistant/tool messages', () => {
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Do something', timestamp: 1 },
        { id: '2', role: 'assistant', content: 'Response 1', timestamp: 2 },
        { id: '3', role: 'tool', content: 'Tool output 1', toolName: 'Bash', timestamp: 3 },
        { id: '4', role: 'assistant', content: 'Response 2', timestamp: 4 },
        { id: '5', role: 'tool', content: 'Tool output 2', toolName: 'Edit', timestamp: 5 },
        { id: '6', role: 'assistant', content: 'Response 3', timestamp: 6 },
        { id: '7', role: 'tool', content: 'Tool output 3', toolName: 'Write', timestamp: 7 },
        { id: '8', role: 'assistant', content: 'Final response', timestamp: 8 },
      ]

      const extracted = manager._extractMessages(messages)

      // Should contain last 5 assistant/tool messages
      expect(extracted).toContain('[Tool (Edit)]')
      expect(extracted).toContain('[Assistant]: Response 2')
      expect(extracted).toContain('[Assistant]: Final response')
      // User messages should be excluded
      expect(extracted).not.toContain('Do something')
    })

    it('returns empty string for no messages', () => {
      expect(manager._extractMessages([])).toBe('')
    })

    it('truncates long content', () => {
      const longContent = 'x'.repeat(2000)
      const messages: Message[] = [
        { id: '1', role: 'assistant', content: longContent, timestamp: 1 },
      ]

      const extracted = manager._extractMessages(messages)
      expect(extracted.length).toBeLessThan(1500)
    })
  })

  describe('digest storage', () => {
    it('stores and retrieves digests', () => {
      const digest: SessionDigest = {
        id: 'digest-1',
        tabId: 'tab-1',
        tabTitle: 'Fix bug',
        projectPath: '/project/a',
        digest: '- Fixed a bug\n- Updated tests',
        filesModified: ['src/main.ts'],
        generatedAt: Date.now(),
        costUsd: 0.02,
      }

      manager._storeDigest(digest)
      const retrieved = manager.getDigestsForProject('/project/a')

      expect(retrieved).toHaveLength(1)
      expect(retrieved[0].digest).toBe('- Fixed a bug\n- Updated tests')
      expect(retrieved[0].tabTitle).toBe('Fix bug')
    })

    it('purges oldest when over 50 digests', () => {
      for (let i = 0; i < 55; i++) {
        manager._storeDigest({
          id: `digest-${i}`,
          tabId: `tab-${i}`,
          tabTitle: `Task ${i}`,
          projectPath: '/project/a',
          digest: `Digest ${i}`,
          filesModified: [],
          generatedAt: Date.now() - (55 - i) * 1000,
          costUsd: 0.01,
        })
      }

      const storage = manager._readStorage()
      expect(storage.digests.length).toBeLessThanOrEqual(50)
    })

    it('returns max 5 per project', () => {
      for (let i = 0; i < 10; i++) {
        manager._storeDigest({
          id: `digest-${i}`,
          tabId: `tab-${i}`,
          tabTitle: `Task ${i}`,
          projectPath: '/project/a',
          digest: `Digest ${i}`,
          filesModified: [],
          generatedAt: Date.now() - (10 - i) * 1000,
          costUsd: 0.01,
        })
      }

      const digests = manager.getDigestsForProject('/project/a')
      expect(digests).toHaveLength(5)
    })
  })

  describe('buildContextInjection', () => {
    it('builds context excluding the requesting tab', () => {
      manager._storeDigest({
        id: 'digest-1',
        tabId: 'tab-1',
        tabTitle: 'Fix API',
        projectPath: '/project/a',
        digest: '- Fixed API endpoint\n- Added error handling',
        filesModified: ['src/api.ts'],
        generatedAt: Date.now(),
        costUsd: 0.02,
      })

      manager._storeDigest({
        id: 'digest-2',
        tabId: 'tab-2',
        tabTitle: 'Add tests',
        projectPath: '/project/a',
        digest: '- Added unit tests',
        filesModified: ['tests/api.test.ts'],
        generatedAt: Date.now(),
        costUsd: 0.01,
      })

      // Tab 1 should see tab 2's digest but not its own
      const context = manager.buildContextInjection('/project/a', 'tab-1')
      expect(context).toContain('Add tests')
      expect(context).toContain('Added unit tests')
      expect(context).not.toContain('Fix API')
    })

    it('returns empty string when no digests', () => {
      expect(manager.buildContextInjection('/project/x', 'tab-1')).toBe('')
    })

    it('returns empty for different project', () => {
      manager._storeDigest({
        id: 'digest-1',
        tabId: 'tab-1',
        tabTitle: 'Work',
        projectPath: '/project/b',
        digest: '- Did things',
        filesModified: [],
        generatedAt: Date.now(),
        costUsd: 0.01,
      })

      expect(manager.buildContextInjection('/project/a', 'tab-2')).toBe('')
    })
  })

  describe('stats', () => {
    it('aggregates stats correctly', () => {
      const now = Date.now()
      manager._storeDigest({
        id: 'd1',
        tabId: 't1',
        tabTitle: 'T1',
        projectPath: '/p',
        digest: 'D1',
        filesModified: [],
        generatedAt: now,
        costUsd: 0.02,
      })
      manager._storeDigest({
        id: 'd2',
        tabId: 't2',
        tabTitle: 'T2',
        projectPath: '/p',
        digest: 'D2',
        filesModified: [],
        generatedAt: now - 60_000,
        costUsd: 0.03,
      })

      const stats = manager.getStats()
      expect(stats.totalDigests).toBe(2)
      expect(stats.totalCostUsd).toBeCloseTo(0.05)
      expect(stats.monthlyDigests).toBe(2)
      expect(stats.monthlyCostUsd).toBeCloseTo(0.05)
    })

    it('returns zero stats when empty', () => {
      const stats = manager.getStats()
      expect(stats.totalDigests).toBe(0)
      expect(stats.totalCostUsd).toBe(0)
    })
  })

  describe('generateDigest', () => {
    it('returns null when disabled', async () => {
      const result = await manager.generateDigest('tab-1', 'Title', '/project', [])
      expect(result).toBeNull()
    })

    it('returns null for empty messages', async () => {
      manager.setSettings({ enabled: true })
      const result = await manager.generateDigest('tab-1', 'Title', '/project', [])
      expect(result).toBeNull()
    })
  })
})
