/**
 * Tests for session store performance optimizations:
 * 1. O(n²) string concatenation fix: text chunks are buffered in _textChunks array
 * 2. Tab reference identity: unchanged tabs keep their object reference
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedEvent, TabState, Message } from '../../src/shared/types'

// vi.hoisted runs before vi.mock factories
const mockClui = vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>).Audio = class MockAudio {
    volume = 1.0
    currentTime = 0
    play = () => Promise.resolve()
    pause = () => {}
  }
  if (!globalThis.crypto) {
    ;(globalThis as Record<string, unknown>).crypto = {
      randomUUID: () => '00000000-0000-0000-0000-000000000000',
    }
  }
  const clui = {
    isVisible: vi.fn().mockResolvedValue(true),
    recordCost: vi.fn(),
    sendDesktopNotification: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue({ version: '1.0', auth: null, projectPath: '~', homePath: '~' }),
    createTab: vi.fn().mockResolvedValue({ tabId: 'new-tab' }),
    closeTab: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
    stopTab: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined),
    initSession: vi.fn().mockResolvedValue(undefined),
    resetTabSession: vi.fn(),
    respondPermission: vi.fn().mockResolvedValue(true),
    setPermissionMode: vi.fn(),
    loadSession: vi.fn().mockResolvedValue([]),
    getAutoAttachConfig: vi.fn().mockResolvedValue({ attachments: [], warnings: [] }),
  }
  ;(globalThis as Record<string, unknown>).window = {
    ...((globalThis as Record<string, unknown>).window || {}),
    clui,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  }
  return clui
})

vi.mock('../../src/renderer/theme', () => ({
  useThemeStore: {
    getState: () => ({
      soundEnabled: false,
      autoResumeEnabled: false,
      autoResumeMaxRetries: 3,
    }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

const mockAddToast = vi.hoisted(() => vi.fn())

vi.mock('../../src/renderer/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: () => ({
      desktopEnabled: false,
      addToast: mockAddToast,
    }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

vi.mock('../../src/renderer/stores/marketplaceStore', () => ({
  useMarketplaceStore: {
    getState: () => ({
      closeMarketplace: vi.fn(),
    }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

vi.mock('../../src/renderer/stores/permissionStore', () => ({
  usePermissionStore: {
    getState: () => ({
      setPermissionMode: vi.fn(),
      respondPermission: vi.fn(),
    }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

vi.mock('../../src/renderer/stores/agentMemoryStore', () => ({
  useAgentMemoryStore: {
    getState: () => ({
      refreshAgentMemory: vi.fn().mockResolvedValue(null),
      setAgentFocus: vi.fn().mockResolvedValue(null),
      claimAgentWork: vi.fn().mockResolvedValue(null),
      markAgentDone: vi.fn().mockResolvedValue(false),
      releaseAgentWork: vi.fn().mockResolvedValue(false),
    }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

vi.mock('../../src/renderer/stores/modelRouterStore', () => ({
  useModelRouterStore: {
    getState: () => ({
      resolveModel: vi.fn().mockReturnValue(null),
    }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

vi.mock('../../src/renderer/stores/budgetStore', () => ({
  useBudgetStore: {
    getState: () => ({
      recordTabCost: vi.fn(),
    }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

vi.mock('../../src/renderer/stores/tokenBudgetStore', () => ({
  useTokenBudgetStore: {
    getState: () => ({
      recordUsage: vi.fn(),
      resetTab: vi.fn(),
    }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

vi.mock('../../src/renderer/stores/faultMemoryStore', () => ({
  useFaultMemoryStore: {
    getState: () => ({
      generatePreamble: vi.fn().mockReturnValue(null),
      markFactsUsed: vi.fn(),
      addFact: vi.fn(),
    }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

vi.mock('../../../resources/notification.mp3', () => ({
  default: 'mock-notification.mp3',
}))

import { useSessionStore, getMessageContent } from '../../src/renderer/stores/sessionStore.impl'

// ─── Helpers ───

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'test-tab',
    claudeSessionId: null,
    status: 'idle',
    activeRequestId: null,
    hasUnread: false,
    currentActivity: '',
    permissionQueue: [],
    permissionDenied: null,
    retryState: null,
    agentAssignment: null,
    lastRunOptions: null,
    queuedRunOptions: [],
    attachments: [],
    messages: [],
    title: 'Test Tab',
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
    lastActivityAt: 0,
    ...overrides,
  }
}

function getTab(tabId = 'test-tab'): TabState | undefined {
  return useSessionStore.getState().tabs.find((t) => t.id === tabId)
}

function dispatchEvent(tabId: string, event: NormalizedEvent): void {
  useSessionStore.getState().handleNormalizedEvent(tabId, event)
}

function seedTab(overrides: Partial<TabState> = {}): string {
  const tab = makeTab(overrides)
  useSessionStore.setState({ tabs: [tab], tabOrder: [tab.id], activeTabId: tab.id })
  return tab.id
}

// ─── Tests ───

describe('text chunk buffering optimization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const tab = makeTab()
    useSessionStore.setState({
      tabs: [tab],
      tabOrder: [tab.id],
      activeTabId: tab.id,
      isExpanded: false,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('getMessageContent returns content when no _textChunks', () => {
    const msg: Message = { id: 'msg-1', role: 'assistant', content: 'hello', timestamp: 0 }
    expect(getMessageContent(msg)).toBe('hello')
  })

  it('getMessageContent joins _textChunks when present', () => {
    const msg: Message = {
      id: 'msg-1',
      role: 'assistant',
      content: '',
      timestamp: 0,
      _textChunks: ['hello', ' ', 'world'],
    }
    expect(getMessageContent(msg)).toBe('hello world')
  })

  it('getMessageContent returns content when _textChunks is empty array', () => {
    const msg: Message = {
      id: 'msg-1',
      role: 'assistant',
      content: 'base',
      timestamp: 0,
      _textChunks: [],
    }
    expect(getMessageContent(msg)).toBe('base')
  })

  it('buffers text_chunk events in _textChunks instead of concatenating content', () => {
    const tabId = seedTab()

    // First text_chunk creates a new assistant message
    dispatchEvent(tabId, { type: 'text_chunk', text: 'Hello' })
    const tab1 = getTab(tabId)!
    const msg1 = tab1.messages[tab1.messages.length - 1]
    expect(msg1.role).toBe('assistant')
    expect(msg1._textChunks).toBeDefined()
    expect(msg1._textChunks).toContain('Hello')
    // content should be empty string (not yet flushed)
    expect(msg1.content).toBe('')

    // Second text_chunk appends to _textChunks
    dispatchEvent(tabId, { type: 'text_chunk', text: ', world' })
    const tab2 = getTab(tabId)!
    const msg2 = tab2.messages[tab2.messages.length - 1]
    expect(msg2._textChunks).toEqual(['Hello', ', world'])
    // content still not flushed
    expect(msg2.content).toBe('')
  })

  it('getMessageContent returns correct joined content during streaming', () => {
    const tabId = seedTab()

    dispatchEvent(tabId, { type: 'text_chunk', text: 'chunk1' })
    dispatchEvent(tabId, { type: 'text_chunk', text: 'chunk2' })
    dispatchEvent(tabId, { type: 'text_chunk', text: 'chunk3' })

    const tab = getTab(tabId)!
    const msg = tab.messages[tab.messages.length - 1]
    expect(getMessageContent(msg)).toBe('chunk1chunk2chunk3')
  })

  it('flushes _textChunks into content on task_complete', () => {
    const tabId = seedTab({ status: 'running', activeRequestId: 'req-1' })

    dispatchEvent(tabId, { type: 'text_chunk', text: 'Hello' })
    dispatchEvent(tabId, { type: 'text_chunk', text: ' there' })

    // Verify chunks are buffered
    const tabBefore = getTab(tabId)!
    const msgBefore = tabBefore.messages[tabBefore.messages.length - 1]
    expect(msgBefore._textChunks).toEqual(['Hello', ' there'])

    // task_complete should flush chunks
    dispatchEvent(tabId, {
      type: 'task_complete',
      result: 'done',
      costUsd: 0.001,
      durationMs: 1000,
      numTurns: 1,
      usage: {},
      sessionId: 'sess-1',
    })

    const tabAfter = getTab(tabId)!
    const flushedMsg = tabAfter.messages.find((m) => m.role === 'assistant')
    expect(flushedMsg).toBeDefined()
    expect(flushedMsg!.content).toBe('Hello there')
    expect(flushedMsg!._textChunks).toBeUndefined()
  })

  it('does not create duplicate assistant messages for consecutive text_chunks', () => {
    const tabId = seedTab()

    for (let i = 0; i < 5; i++) {
      dispatchEvent(tabId, { type: 'text_chunk', text: `chunk${i}` })
    }

    const tab = getTab(tabId)!
    const assistantMsgs = tab.messages.filter((m) => m.role === 'assistant')
    expect(assistantMsgs).toHaveLength(1)
    expect(getMessageContent(assistantMsgs[0])).toBe('chunk0chunk1chunk2chunk3chunk4')
  })

  it('starts a new assistant message after a tool_call', () => {
    const tabId = seedTab()

    dispatchEvent(tabId, { type: 'text_chunk', text: 'before tool' })
    dispatchEvent(tabId, {
      type: 'tool_call',
      toolName: 'bash',
      toolId: 'tool-1',
      index: 0,
    })
    dispatchEvent(tabId, { type: 'text_chunk', text: 'after tool' })

    const tab = getTab(tabId)!
    const assistantMsgs = tab.messages.filter((m) => m.role === 'assistant')
    expect(assistantMsgs).toHaveLength(2)
    expect(getMessageContent(assistantMsgs[0])).toBe('before tool')
    expect(getMessageContent(assistantMsgs[1])).toBe('after tool')
  })
})

describe('tab reference identity optimization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('preserves reference identity of unchanged tabs when one tab receives an event', () => {
    const tab1 = makeTab({ id: 'tab-1', title: 'Tab 1' })
    const tab2 = makeTab({ id: 'tab-2', title: 'Tab 2' })
    const tab3 = makeTab({ id: 'tab-3', title: 'Tab 3' })

    useSessionStore.setState({
      tabs: [tab1, tab2, tab3],
      tabOrder: ['tab-1', 'tab-2', 'tab-3'],
      activeTabId: 'tab-1',
      isExpanded: false,
    })

    // Record references before the event
    const tabsBefore = useSessionStore.getState().tabs
    const tab1Before = tabsBefore.find((t) => t.id === 'tab-1')!
    const tab2Before = tabsBefore.find((t) => t.id === 'tab-2')!
    const tab3Before = tabsBefore.find((t) => t.id === 'tab-3')!

    // Dispatch event targeting only tab-1
    dispatchEvent('tab-1', { type: 'text_chunk', text: 'hello' })

    const tabsAfter = useSessionStore.getState().tabs
    const tab1After = tabsAfter.find((t) => t.id === 'tab-1')!
    const tab2After = tabsAfter.find((t) => t.id === 'tab-2')!
    const tab3After = tabsAfter.find((t) => t.id === 'tab-3')!

    // tab-1 should be a new object (it was modified)
    expect(tab1After).not.toBe(tab1Before)

    // tab-2 and tab-3 should be the SAME object references (not copied)
    expect(tab2After).toBe(tab2Before)
    expect(tab3After).toBe(tab3Before)
  })

  it('preserves reference identity for all unchanged tabs on session_init', () => {
    const tab1 = makeTab({ id: 'tab-1', status: 'connecting', activeRequestId: 'req-1' })
    const tab2 = makeTab({ id: 'tab-2' })
    const tab3 = makeTab({ id: 'tab-3' })

    useSessionStore.setState({
      tabs: [tab1, tab2, tab3],
      tabOrder: ['tab-1', 'tab-2', 'tab-3'],
      activeTabId: 'tab-1',
      isExpanded: false,
    })

    const tab2Ref = useSessionStore.getState().tabs.find((t) => t.id === 'tab-2')!
    const tab3Ref = useSessionStore.getState().tabs.find((t) => t.id === 'tab-3')!

    dispatchEvent('tab-1', {
      type: 'session_init',
      sessionId: 'sess-1',
      tools: [],
      model: 'claude-sonnet',
      mcpServers: [],
      skills: [],
      version: '1.0',
    })

    const tab2After = useSessionStore.getState().tabs.find((t) => t.id === 'tab-2')!
    const tab3After = useSessionStore.getState().tabs.find((t) => t.id === 'tab-3')!

    expect(tab2After).toBe(tab2Ref)
    expect(tab3After).toBe(tab3Ref)
  })

  it('returns same tabs array reference when event targets unknown tab', () => {
    const tab1 = makeTab({ id: 'tab-1' })

    useSessionStore.setState({
      tabs: [tab1],
      tabOrder: ['tab-1'],
      activeTabId: 'tab-1',
      isExpanded: false,
    })

    const tabsBefore = useSessionStore.getState().tabs

    // Dispatch to unknown tab ID — should be a no-op
    dispatchEvent('unknown-tab', { type: 'text_chunk', text: 'hello' })

    const tabsAfter = useSessionStore.getState().tabs

    // The tabs array itself and all elements should be unchanged
    expect(tabsAfter).toBe(tabsBefore)
  })

  it('preserves tab identity for large numbers of tabs when one changes', () => {
    const tabs = Array.from({ length: 20 }, (_, i) =>
      makeTab({ id: `tab-${i}`, title: `Tab ${i}` })
    )

    useSessionStore.setState({
      tabs,
      tabOrder: tabs.map((t) => t.id),
      activeTabId: 'tab-0',
      isExpanded: false,
    })

    const refsBefore = useSessionStore.getState().tabs.map((t) => t)

    dispatchEvent('tab-5', { type: 'text_chunk', text: 'test' })

    const refsAfter = useSessionStore.getState().tabs

    for (let i = 0; i < 20; i++) {
      if (i === 5) {
        // tab-5 was modified, so it should be a new object
        expect(refsAfter[i]).not.toBe(refsBefore[i])
      } else {
        // All other tabs should have same reference
        expect(refsAfter[i]).toBe(refsBefore[i])
      }
    }
  })
})
