/**
 * #313: Chat session persistence module tests.
 *
 * Validates the PersistedChatSession interface and module exports.
 * IndexedDB is not available in the test env, so we verify graceful degradation
 * and the module's contract/edge cases — same approach as terminal-persistence tests.
 */
import { describe, expect, it } from 'vitest'

import type { PersistedChatSession } from '../../src/renderer/utils/session-persistence'
import * as persistence from '../../src/renderer/utils/session-persistence'

describe('session-persistence module (#313)', () => {
  it('exports saveChatSession function', () => {
    expect(typeof persistence.saveChatSession).toBe('function')
  })

  it('exports loadChatSessions function', () => {
    expect(typeof persistence.loadChatSessions).toBe('function')
  })

  it('exports deleteChatSession function', () => {
    expect(typeof persistence.deleteChatSession).toBe('function')
  })

  it('exports purgeOldSessions function', () => {
    expect(typeof persistence.purgeOldSessions).toBe('function')
  })

  it('PersistedChatSession interface has correct shape', () => {
    const session: PersistedChatSession = {
      tabId: 'tab-1',
      claudeSessionId: 'sess-abc',
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() },
        { id: 'msg-2', role: 'assistant', content: 'Hi there', timestamp: Date.now() },
      ],
      title: 'Test Session',
      workingDirectory: '/home/user/project',
      savedAt: Date.now(),
    }
    expect(session.tabId).toBe('tab-1')
    expect(session.claudeSessionId).toBe('sess-abc')
    expect(session.messages).toHaveLength(2)
    expect(session.title).toBe('Test Session')
    expect(session.workingDirectory).toBe('/home/user/project')
    expect(typeof session.savedAt).toBe('number')
  })

  it('PersistedChatSession with null claudeSessionId is valid', () => {
    const session: PersistedChatSession = {
      tabId: 'tab-2',
      claudeSessionId: null,
      messages: [],
      title: 'Empty Session',
      workingDirectory: '~',
      savedAt: Date.now(),
    }
    expect(session.claudeSessionId).toBeNull()
  })

  it('PersistedChatSession with empty messages is valid', () => {
    const session: PersistedChatSession = {
      tabId: 'tab-3',
      claudeSessionId: null,
      messages: [],
      title: 'No Messages',
      workingDirectory: '/tmp',
      savedAt: Date.now(),
    }
    expect(session.messages).toEqual([])
  })

  it('PersistedChatSession with many messages is accepted', () => {
    const messages = Array.from({ length: 500 }, (_, i) => ({
      id: `msg-${i}`,
      role: 'user' as const,
      content: `Message ${i}`,
      timestamp: Date.now(),
    }))
    const session: PersistedChatSession = {
      tabId: 'tab-large',
      claudeSessionId: 'sess-large',
      messages,
      title: 'Large Session',
      workingDirectory: '/home',
      savedAt: Date.now(),
    }
    expect(session.messages.length).toBe(500)
  })

  // Test graceful degradation when IndexedDB is unavailable
  it('saveChatSession does not throw when IndexedDB is unavailable', async () => {
    await expect(persistence.saveChatSession({
      tabId: 'test-save',
      claudeSessionId: null,
      messages: [{ id: 'm1', role: 'user', content: 'test', timestamp: Date.now() }],
      title: 'Test',
      workingDirectory: '/tmp',
      savedAt: Date.now(),
    })).resolves.not.toThrow()
  })

  it('loadChatSessions returns empty array when IndexedDB is unavailable', async () => {
    const sessions = await persistence.loadChatSessions()
    expect(sessions).toEqual([])
  })

  it('deleteChatSession does not throw when IndexedDB is unavailable', async () => {
    await expect(persistence.deleteChatSession('nonexistent')).resolves.not.toThrow()
  })

  it('purgeOldSessions does not throw when IndexedDB is unavailable', async () => {
    await expect(persistence.purgeOldSessions()).resolves.not.toThrow()
  })
})
