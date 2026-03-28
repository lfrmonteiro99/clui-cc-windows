/**
 * ENRICH-008: Session Digest — Integration Tests
 *
 * Tests settings persistence, message extraction, digest storage,
 * purge, and context injection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DigestStore,
  extractForDigest,
  buildContextInjection,
  type SessionDigest,
  type DigestSettings,
} from '../../src/shared/enrich/session-digest'
import type { Message } from '../../src/shared/types'

// ── In-memory read/write for testability ──

function createMemoryStorage() {
  const data: Record<string, string> = {}
  return {
    read: (key: string): string | null => data[key] ?? null,
    write: (key: string, value: string): void => { data[key] = value },
    getData: () => ({ ...data }),
  }
}

// ── Tests ──

describe('ENRICH-008: Session Digest Integration', () => {
  let storage: ReturnType<typeof createMemoryStorage>

  beforeEach(() => {
    storage = createMemoryStorage()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── Settings persistence ───

  describe('settings persistence', () => {
    it('loads default settings when none saved', () => {
      const store = new DigestStore(storage.read, storage.write)
      const settings = store.getSettings()
      expect(settings.enabled).toBe(true)
      expect(settings.maxDigests).toBe(50)
      expect(settings.maxMessageLength).toBe(200)
    })

    it('saves and loads custom settings', () => {
      const store1 = new DigestStore(storage.read, storage.write)
      store1.saveSettings({ enabled: false, maxDigests: 25 })

      // New instance loads from storage
      const store2 = new DigestStore(storage.read, storage.write)
      const settings = store2.getSettings()
      expect(settings.enabled).toBe(false)
      expect(settings.maxDigests).toBe(25)
      expect(settings.maxMessageLength).toBe(200) // unchanged default
    })
  })

  // ─── Message extraction ───

  describe('extractForDigest', () => {
    it('truncates long messages', () => {
      const longContent = 'x'.repeat(500)
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Short', timestamp: 1 },
        { id: '2', role: 'assistant', content: longContent, timestamp: 2 },
      ]

      const extracted = extractForDigest(messages, 200)
      expect(extracted.length).toBe(2)
      expect(extracted[0].text).toBe('Short')
      expect(extracted[1].text.length).toBe(203) // 200 + "..."
      expect(extracted[1].text).toMatch(/\.\.\.$/  )
    })

    it('filters out tool and system messages', () => {
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Question', timestamp: 1 },
        { id: '2', role: 'tool', content: 'tool output', toolName: 'Read', timestamp: 2 },
        { id: '3', role: 'system', content: 'system note', timestamp: 3 },
        { id: '4', role: 'assistant', content: 'Answer', timestamp: 4 },
      ]

      const extracted = extractForDigest(messages)
      expect(extracted.length).toBe(2)
      expect(extracted[0].role).toBe('user')
      expect(extracted[1].role).toBe('assistant')
    })

    it('handles _textChunks', () => {
      const messages: Message[] = [
        { id: '1', role: 'assistant', content: '', _textChunks: ['Hello ', 'world'], timestamp: 1 },
      ]

      const extracted = extractForDigest(messages)
      expect(extracted[0].text).toBe('Hello world')
    })
  })

  // ─── Digest storage ───

  describe('digest storage', () => {
    it('save → load → data integrity', () => {
      const store = new DigestStore(storage.read, storage.write)

      const digest: SessionDigest = {
        id: 'dig-1',
        tabId: 'tab-1',
        title: 'Test Session',
        summary: 'Did some coding',
        createdAt: Date.now(),
        messageCount: 10,
      }

      store.saveDigest(digest)
      const loaded = store.loadAllDigests()
      expect(loaded.length).toBe(1)
      expect(loaded[0].id).toBe('dig-1')
      expect(loaded[0].title).toBe('Test Session')
      expect(loaded[0].summary).toBe('Did some coding')
    })

    it('persists across store instances', () => {
      const store1 = new DigestStore(storage.read, storage.write)
      store1.saveDigest({
        id: 'dig-1', tabId: 'tab-1', title: 'Session A',
        summary: 'Summary A', createdAt: Date.now(), messageCount: 5,
      })

      const store2 = new DigestStore(storage.read, storage.write)
      expect(store2.loadAllDigests().length).toBe(1)
    })
  })

  // ─── Purge ───

  describe('purge', () => {
    it('save 60 digests → only 50 remain (default maxDigests)', () => {
      const store = new DigestStore(storage.read, storage.write)

      for (let i = 0; i < 60; i++) {
        store.saveDigest({
          id: `dig-${i}`,
          tabId: `tab-${i}`,
          title: `Session ${i}`,
          summary: `Summary ${i}`,
          createdAt: Date.now() + i, // newer ones have higher timestamps
          messageCount: i,
        })
      }

      const loaded = store.loadAllDigests()
      expect(loaded.length).toBe(50)
      // Should keep the most recent ones
      const ids = loaded.map((d) => d.id)
      expect(ids).toContain('dig-59') // newest
      expect(ids).not.toContain('dig-0') // oldest should be purged
    })
  })

  // ─── Context injection ───

  describe('buildContextInjection', () => {
    it('formats multiple digests', () => {
      const digests: SessionDigest[] = [
        { id: 'd1', tabId: 'tab-1', title: 'Setup', summary: 'Set up the project', createdAt: 1, messageCount: 5 },
        { id: 'd2', tabId: 'tab-2', title: 'Feature', summary: 'Added new feature', createdAt: 2, messageCount: 8 },
      ]

      const result = buildContextInjection(digests)
      expect(result).toContain('Previous session context:')
      expect(result).toContain('[Setup]')
      expect(result).toContain('[Feature]')
      expect(result).toContain('5 messages')
      expect(result).toContain('8 messages')
    })

    it('excludeTabId filters out the specified tab', () => {
      const digests: SessionDigest[] = [
        { id: 'd1', tabId: 'tab-1', title: 'Self', summary: 'My session', createdAt: 1, messageCount: 3 },
        { id: 'd2', tabId: 'tab-2', title: 'Other', summary: 'Other session', createdAt: 2, messageCount: 7 },
      ]

      const result = buildContextInjection(digests, 'tab-1')
      expect(result).not.toContain('[Self]')
      expect(result).toContain('[Other]')
    })

    it('returns empty string when no digests', () => {
      expect(buildContextInjection([])).toBe('')
    })

    it('returns empty string when all digests are excluded', () => {
      const digests: SessionDigest[] = [
        { id: 'd1', tabId: 'tab-1', title: 'Only', summary: 'Only session', createdAt: 1, messageCount: 2 },
      ]
      expect(buildContextInjection(digests, 'tab-1')).toBe('')
    })
  })
})
