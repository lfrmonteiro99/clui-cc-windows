import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedEvent, TabState } from '../../src/shared/types'

// vi.hoisted runs before vi.mock factories
vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>).Audio = class MockAudio {
    volume = 1.0
    currentTime = 0
    play = () => Promise.resolve()
    pause = () => {}
  }
  if (!globalThis.crypto) {
    ;(globalThis as Record<string, unknown>).crypto = { randomUUID: () => '00000000-0000-0000-0000-000000000000' }
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

vi.mock('../../src/renderer/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: () => ({
      desktopEnabled: false,
      addToast: vi.fn(),
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

vi.mock('../../../resources/notification.mp3', () => ({
  default: 'mock-notification.mp3',
}))

import { useSessionStore } from '../../src/renderer/stores/sessionStore.impl'

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'test-tab',
    claudeSessionId: null,
    status: 'running' as const,
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
    sandboxState: { enabled: false },
    tokenUsage: null,
    contextNotificationShown: false,
    ...overrides,
  } as TabState
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

describe('Content-type detection badge in sessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState(useSessionStore.getInitialState(), true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sets currentActivity to "Writing..." for plain text chunks', () => {
    const tabId = seedTab({ status: 'running' })
    // First chunk triggers detection (prevChunkCount=0, 0%5===0)
    dispatchEvent(tabId, { type: 'text_chunk', text: 'Hello world' })
    const tab = getTab(tabId)
    expect(tab?.currentActivity).toBe('Writing...')
  })

  it('detects "Writing code..." when code fence is open', () => {
    const tabId = seedTab({
      status: 'running',
      messages: [{ id: 'msg-1', role: 'assistant', content: '', _textChunks: [], timestamp: Date.now() }],
    })
    // Send a chunk with an open code fence — detection fires on chunk 0
    // We need to seed with 0 chunks (so prevChunkCount=0, 0%5===0)
    dispatchEvent(tabId, { type: 'text_chunk', text: 'Here is code:\n```python\nprint("hi")\n' })
    const tab = getTab(tabId)
    expect(tab?.currentActivity).toBe('Writing code...')
  })

  it('detects "Listing steps" for numbered lists', () => {
    const tabId = seedTab({
      status: 'running',
      messages: [{ id: 'msg-1', role: 'assistant', content: '', _textChunks: [], timestamp: Date.now() }],
    })
    dispatchEvent(tabId, { type: 'text_chunk', text: '1. First\n2. Second\n3. Third\n' })
    const tab = getTab(tabId)
    expect(tab?.currentActivity).toMatch(/^Listing steps \(\d+\)\.\.\.$/)
  })

  it('throttles detection — skips update on non-5th chunks', () => {
    const tabId = seedTab({
      status: 'running',
      messages: [{
        id: 'msg-1',
        role: 'assistant',
        content: '',
        _textChunks: ['a', 'b', 'c'],  // 3 existing chunks
        timestamp: Date.now(),
      }],
    })
    // prevChunkCount=3, 3%5!==0 → detection skipped, currentActivity unchanged
    dispatchEvent(tabId, { type: 'text_chunk', text: 'd' })
    const tab = getTab(tabId)
    // currentActivity should remain empty (the initial value) since detection was skipped
    expect(tab?.currentActivity).toBe('')
  })
})
