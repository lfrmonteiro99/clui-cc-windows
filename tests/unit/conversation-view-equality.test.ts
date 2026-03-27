import { describe, it, expect } from 'vitest'
import type { TabState, Message } from '../../src/shared/types'

/**
 * BUG-007: ConversationView equality check misses changes.
 *
 * The equality function only compares id, messages.length, and status.
 * This means it misses:
 *  - Changes to the last message's _textChunks (streaming text updates)
 *  - Changes to tool message's toolStatus (running -> completed)
 *
 * We test the equality logic in isolation here.
 */

// Extracted equality function matching the one used in ConversationView
// This is what the FIXED version should look like:
function conversationViewEquality(a: TabState | undefined, b: TabState | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return a === b
  return (
    a.id === b.id &&
    a.messages.length === b.messages.length &&
    a.status === b.status &&
    lastMessageTextChunksLength(a.messages) === lastMessageTextChunksLength(b.messages) &&
    lastMessageToolStatus(a.messages) === lastMessageToolStatus(b.messages)
  )
}

function lastMessageTextChunksLength(msgs: Message[]): number {
  if (msgs.length === 0) return 0
  return msgs[msgs.length - 1]._textChunks?.length ?? 0
}

function lastMessageToolStatus(msgs: Message[]): string | undefined {
  if (msgs.length === 0) return undefined
  return msgs[msgs.length - 1].toolStatus
}

// The OLD buggy equality — for comparison
function buggyEquality(a: TabState | undefined, b: TabState | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return a === b
  return (
    a.id === b.id &&
    a.messages.length === b.messages.length &&
    a.status === b.status
  )
}

function makeTab(msgs: Message[]): TabState {
  return {
    id: 'tab-1',
    claudeSessionId: null,
    status: 'running',
    activeRequestId: 'req-1',
    hasUnread: false,
    currentActivity: '',
    permissionQueue: [],
    permissionDenied: null,
    retryState: null,
    agentAssignment: null,
    lastRunOptions: null,
    queuedRunOptions: [],
    attachments: [],
    messages: msgs,
    title: 'Test',
    lastResult: null,
    sessionModel: null,
    sessionTools: [],
    sessionMcpServers: [],
    sessionSkills: [],
    sessionVersion: null,
    queuedPrompts: [],
    workingDirectory: '~',
    hasChosenDirectory: false,
    additionalDirs: [],
    runtime: 'native',
    wslDistro: null,
  }
}

describe('BUG-007: ConversationView equality check', () => {
  it('detects text chunk growth on the last message', () => {
    const msg1: Message = { id: 'm1', role: 'assistant', content: '', timestamp: 1, _textChunks: ['Hello'] }
    const msg2: Message = { id: 'm1', role: 'assistant', content: '', timestamp: 1, _textChunks: ['Hello', ' World'] }

    const tabA = makeTab([msg1])
    const tabB = makeTab([msg2])

    // Buggy version would consider these equal (same length, same status, same id)
    expect(buggyEquality(tabA, tabB)).toBe(true) // confirms the bug exists

    // Fixed version should detect the difference
    expect(conversationViewEquality(tabA, tabB)).toBe(false)
  })

  it('detects toolStatus change on the last message', () => {
    const msg1: Message = { id: 'm1', role: 'tool', content: '', toolName: 'Read', toolStatus: 'running', timestamp: 1 }
    const msg2: Message = { id: 'm1', role: 'tool', content: '', toolName: 'Read', toolStatus: 'completed', timestamp: 1 }

    const tabA = makeTab([msg1])
    const tabB = makeTab([msg2])

    // Buggy version would consider these equal
    expect(buggyEquality(tabA, tabB)).toBe(true) // confirms the bug exists

    // Fixed version should detect the difference
    expect(conversationViewEquality(tabA, tabB)).toBe(false)
  })

  it('still considers truly equal tabs as equal', () => {
    const msg: Message = { id: 'm1', role: 'assistant', content: 'Hello', timestamp: 1 }
    const tabA = makeTab([msg])
    const tabB = makeTab([msg])

    expect(conversationViewEquality(tabA, tabB)).toBe(true)
  })

  it('handles both undefined tabs', () => {
    expect(conversationViewEquality(undefined, undefined)).toBe(true)
  })

  it('handles one undefined tab', () => {
    const tab = makeTab([])
    expect(conversationViewEquality(tab, undefined)).toBe(false)
    expect(conversationViewEquality(undefined, tab)).toBe(false)
  })
})
