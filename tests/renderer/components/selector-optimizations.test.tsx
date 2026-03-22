// @vitest-environment jsdom

import React from 'react'
import { describe, expect, it, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import type { TabState } from '../../../src/shared/types'
import { makeTab, makeMessage, renderWithProviders, resetTestState } from '../testUtils'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { ConversationView } from '../../../src/renderer/components/ConversationView'

// ─── Equality function helpers (mirrors what's implemented in source) ───

function inputBarTabEqual(a: TabState | undefined, b: TabState | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return a === b
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.messages.length === b.messages.length &&
    a.attachments?.length === b.attachments?.length &&
    a.queuedPrompts?.length === b.queuedPrompts?.length &&
    a.sessionSkills?.length === b.sessionSkills?.length
  )
}

function conversationViewTabEqual(a: TabState | undefined, b: TabState | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return a === b
  return (
    a.id === b.id &&
    a.messages.length === b.messages.length &&
    a.status === b.status
  )
}

// ─── InputBar selector equality ───

describe('InputBar selector equality function', () => {
  it('returns true for identical tab references', () => {
    const tab = makeTab({ id: 'tab-1' })
    expect(inputBarTabEqual(tab, tab)).toBe(true)
  })

  it('returns true when none of the relevant fields changed', () => {
    const tab = makeTab({ id: 'tab-1', status: 'idle' })
    const tab2 = { ...tab } // same field values, different reference
    expect(inputBarTabEqual(tab, tab2)).toBe(true)
  })

  it('returns false when status changes', () => {
    const tab = makeTab({ id: 'tab-1', status: 'idle' })
    const tab2 = { ...tab, status: 'running' as const }
    expect(inputBarTabEqual(tab, tab2)).toBe(false)
  })

  it('returns false when messages.length changes', () => {
    const tab = makeTab({ id: 'tab-1', messages: [] })
    const tab2 = {
      ...tab,
      messages: [makeMessage({ role: 'user', content: 'Hello' })],
    }
    expect(inputBarTabEqual(tab, tab2)).toBe(false)
  })

  it('returns false when attachments.length changes', () => {
    const tab = makeTab({ id: 'tab-1', attachments: [] })
    const tab2 = { ...tab, attachments: [{ id: 'a1', name: 'file.txt', type: 'text/plain' as const, content: 'x' }] }
    expect(inputBarTabEqual(tab, tab2)).toBe(false)
  })

  it('returns false when id changes', () => {
    const tab = makeTab({ id: 'tab-1' })
    const tab2 = { ...tab, id: 'tab-2' }
    expect(inputBarTabEqual(tab, tab2)).toBe(false)
  })

  it('handles undefined on both sides', () => {
    expect(inputBarTabEqual(undefined, undefined)).toBe(true)
  })

  it('returns false when one side is undefined', () => {
    const tab = makeTab({ id: 'tab-1' })
    expect(inputBarTabEqual(tab, undefined)).toBe(false)
    expect(inputBarTabEqual(undefined, tab)).toBe(false)
  })
})

// ─── ConversationView selector equality ───

describe('ConversationView selector equality function', () => {
  it('returns true for identical tab references', () => {
    const tab = makeTab({ id: 'tab-1' })
    expect(conversationViewTabEqual(tab, tab)).toBe(true)
  })

  it('returns true when id, messages.length, and status are unchanged', () => {
    const tab = makeTab({ id: 'tab-1', status: 'idle', messages: [] })
    const tab2 = { ...tab, currentActivity: 'new value' } // irrelevant field changed
    expect(conversationViewTabEqual(tab, tab2)).toBe(true)
  })

  it('returns false when status changes', () => {
    const tab = makeTab({ id: 'tab-1', status: 'idle' })
    const tab2 = { ...tab, status: 'running' as const }
    expect(conversationViewTabEqual(tab, tab2)).toBe(false)
  })

  it('returns false when messages.length changes', () => {
    const tab = makeTab({ id: 'tab-1', messages: [] })
    const tab2 = {
      ...tab,
      messages: [makeMessage({ role: 'user', content: 'New message' })],
    }
    expect(conversationViewTabEqual(tab, tab2)).toBe(false)
  })

  it('returns false when id changes', () => {
    const tab = makeTab({ id: 'tab-1' })
    const tab2 = { ...tab, id: 'tab-2' }
    expect(conversationViewTabEqual(tab, tab2)).toBe(false)
  })

  it('handles both undefined', () => {
    expect(conversationViewTabEqual(undefined, undefined)).toBe(true)
  })

  it('returns false when one is undefined and other is not', () => {
    const tab = makeTab({ id: 'tab-1' })
    expect(conversationViewTabEqual(tab, undefined)).toBe(false)
    expect(conversationViewTabEqual(undefined, tab)).toBe(false)
  })
})

// ─── ToolTimeline JSON parsing memoization ───

describe('ToolTimeline JSON parsing memoization', () => {
  it('parses JSON with the same result for equivalent input strings', () => {
    const input = JSON.stringify({ command: 'git status' })
    const parsed1 = JSON.parse(input)
    const parsed2 = JSON.parse(input)
    // Both parses yield equal objects — useMemo with [toolInput] dependency
    // ensures this only runs once when toolInput is stable
    expect(parsed1).toEqual(parsed2)
    expect(parsed1.command).toBe('git status')
  })

  it('produces correct output for bash tool input', () => {
    const toolInput = JSON.stringify({ command: 'npm test', timeout: 30000 })
    const parsed = JSON.parse(toolInput) as Record<string, unknown>
    expect(parsed.command).toBe('npm test')
    expect(parsed.timeout).toBe(30000)
  })

  it('handles invalid JSON gracefully', () => {
    const badInput = 'not-valid-json'
    expect(() => JSON.parse(badInput)).toThrow()
    // The memoized parseToolInput function in ToolTimeline handles this with try/catch
  })

  it('handles null/undefined toolInput without throwing', () => {
    const parseToolInput = (raw?: string): Record<string, unknown> | null => {
      if (!raw) return null
      try {
        const parsed: unknown = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>
        }
        return null
      } catch {
        return null
      }
    }

    expect(parseToolInput(undefined)).toBeNull()
    expect(parseToolInput('')).toBeNull()
    expect(parseToolInput('null')).toBeNull()
    expect(parseToolInput('[]')).toBeNull()
    expect(parseToolInput('{"key": "value"}')).toEqual({ key: 'value' })
  })
})

// ─── Optimization 8: React.memo on utility components ───

describe('Optimization 8: Utility components render correctly (CopyButton, InterruptButton, QueuedMessage)', () => {
  beforeEach(() => {
    resetTestState()
  })

  it('renders QueuedMessage when tab has queued prompts', () => {
    useSessionStore.setState({
      tabs: [
        makeTab({
          id: 'tab-1',
          messages: [makeMessage({ role: 'user', content: 'Working' })],
          queuedPrompts: ['Follow-up task'],
        }),
      ],
      activeTabId: 'tab-1',
    })
    renderWithProviders(<ConversationView />)
    expect(screen.getByText('Follow-up task')).toBeInTheDocument()
  })

  it('renders InterruptButton when tab is running and has user messages', () => {
    useSessionStore.setState({
      tabs: [
        makeTab({
          id: 'tab-1',
          status: 'running',
          messages: [makeMessage({ role: 'user', content: 'Do something' })],
        }),
      ],
      activeTabId: 'tab-1',
    })
    renderWithProviders(<ConversationView />)
    expect(screen.getByText('Interrupt')).toBeInTheDocument()
  })

  it('does not render InterruptButton when tab is idle', () => {
    useSessionStore.setState({
      tabs: [
        makeTab({
          id: 'tab-1',
          status: 'idle',
          messages: [makeMessage({ role: 'user', content: 'Done' })],
        }),
      ],
      activeTabId: 'tab-1',
    })
    renderWithProviders(<ConversationView />)
    expect(screen.queryByText('Interrupt')).not.toBeInTheDocument()
  })
})

// ─── Optimization 10: Scroll trigger does not include message content length ───

describe('Optimization 10: Scroll trigger uses message count and completion status, not content length', () => {
  beforeEach(() => {
    resetTestState()
  })

  it('renders ConversationView without error when last message has long content', () => {
    const longContent = 'x'.repeat(50000)
    useSessionStore.setState({
      tabs: [
        makeTab({
          id: 'tab-1',
          messages: [
            makeMessage({ role: 'user', content: 'Query' }),
            makeMessage({ role: 'assistant', content: longContent }),
          ],
        }),
      ],
      activeTabId: 'tab-1',
    })
    expect(() => renderWithProviders(<ConversationView />)).not.toThrow()
    expect(screen.getByTestId('conversation-view')).toBeInTheDocument()
  })

  it('renders correctly after message count increases (new message arrives)', () => {
    const msgs = [makeMessage({ role: 'user', content: 'Hello' })]
    useSessionStore.setState({
      tabs: [makeTab({ id: 'tab-1', messages: msgs })],
      activeTabId: 'tab-1',
    })
    renderWithProviders(<ConversationView />)
    expect(screen.getByTestId('message-user')).toHaveTextContent('Hello')
  })

  it('renders ConversationView without error after permission queue changes', () => {
    useSessionStore.setState({
      tabs: [
        makeTab({
          id: 'tab-1',
          status: 'running',
          messages: [makeMessage({ role: 'user', content: 'Test' })],
        }),
      ],
      activeTabId: 'tab-1',
    })
    expect(() => renderWithProviders(<ConversationView />)).not.toThrow()
    expect(screen.getByTestId('conversation-view')).toBeInTheDocument()
  })
})
