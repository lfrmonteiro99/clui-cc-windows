import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedEvent, TabState } from '../../src/shared/types'

// vi.hoisted runs before vi.mock factories — define Audio and window.clui
const mockClui = vi.hoisted(() => {
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

vi.mock('../../../resources/notification.mp3', () => ({
  default: 'mock-notification.mp3',
}))

import { useSessionStore } from '../../src/renderer/stores/sessionStore.impl'

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
    sandboxState: { enabled: false, activeWorktree: null, pendingDiff: null, mergeStatus: 'idle' as const },
    tokenUsage: null,
    contextNotificationShown: false,
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

describe('Token tracking (Phase A)', () => {
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
    vi.restoreAllMocks()
  })

  describe('token_usage accumulation', () => {
    it('initializes tokenUsage from first token_usage event', () => {
      const tabId = seedTab()
      dispatchEvent(tabId, {
        type: 'token_usage',
        inputTokens: 500,
        outputTokens: 200,
        totalTokens: 700,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
      })

      const tab = getTab(tabId)!
      expect(tab.tokenUsage).not.toBeNull()
      expect(tab.tokenUsage!.inputTokens).toBe(500)
      expect(tab.tokenUsage!.outputTokens).toBe(200)
      expect(tab.tokenUsage!.totalTokens).toBe(700)
      expect(tab.tokenUsage!.cacheReadTokens).toBe(100)
      expect(tab.tokenUsage!.cacheWriteTokens).toBe(50)
      expect(tab.tokenUsage!.lastUpdated).toBeGreaterThan(0)
    })

    it('accumulates tokens across multiple events', () => {
      const tabId = seedTab()

      dispatchEvent(tabId, {
        type: 'token_usage',
        inputTokens: 500,
        outputTokens: 200,
        totalTokens: 700,
      })

      dispatchEvent(tabId, {
        type: 'token_usage',
        inputTokens: 300,
        outputTokens: 100,
        totalTokens: 400,
      })

      const tab = getTab(tabId)!
      expect(tab.tokenUsage!.inputTokens).toBe(800)
      expect(tab.tokenUsage!.outputTokens).toBe(300)
      expect(tab.tokenUsage!.totalTokens).toBe(1100)
    })

    it('accumulates cache tokens correctly', () => {
      const tabId = seedTab()

      dispatchEvent(tabId, {
        type: 'token_usage',
        inputTokens: 500,
        outputTokens: 200,
        totalTokens: 700,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
      })

      dispatchEvent(tabId, {
        type: 'token_usage',
        inputTokens: 300,
        outputTokens: 100,
        totalTokens: 400,
        cacheReadTokens: 200,
        cacheWriteTokens: 0,
      })

      const tab = getTab(tabId)!
      expect(tab.tokenUsage!.cacheReadTokens).toBe(300)
      expect(tab.tokenUsage!.cacheWriteTokens).toBe(50)
    })

    it('handles missing cache tokens (defaults to 0)', () => {
      const tabId = seedTab()

      dispatchEvent(tabId, {
        type: 'token_usage',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        // no cacheReadTokens or cacheWriteTokens
      })

      const tab = getTab(tabId)!
      expect(tab.tokenUsage!.cacheReadTokens).toBe(0)
      expect(tab.tokenUsage!.cacheWriteTokens).toBe(0)
    })

    it('does not update tokenUsage for non-existent tab', () => {
      seedTab()
      // Dispatch to a tab that doesn't exist
      dispatchEvent('nonexistent-tab', {
        type: 'token_usage',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      })

      // Original tab should be unchanged
      const tab = getTab()!
      expect(tab.tokenUsage).toBeNull()
    })
  })

  describe('per-tab isolation', () => {
    it('tracks token usage independently per tab', () => {
      const tab1 = makeTab({ id: 'tab-1' })
      const tab2 = makeTab({ id: 'tab-2' })
      useSessionStore.setState({
        tabs: [tab1, tab2],
        tabOrder: [tab1.id, tab2.id],
        activeTabId: tab1.id,
      })

      dispatchEvent('tab-1', {
        type: 'token_usage',
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      })

      dispatchEvent('tab-2', {
        type: 'token_usage',
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
      })

      const t1 = useSessionStore.getState().tabs.find((t) => t.id === 'tab-1')!
      const t2 = useSessionStore.getState().tabs.find((t) => t.id === 'tab-2')!
      expect(t1.tokenUsage!.totalTokens).toBe(1500)
      expect(t2.tokenUsage!.totalTokens).toBe(300)
    })
  })

  describe('reset on clear', () => {
    it('resets tokenUsage and contextNotificationShown when tab is cleared', () => {
      const tabId = seedTab()

      // Add some token usage
      dispatchEvent(tabId, {
        type: 'token_usage',
        inputTokens: 50000,
        outputTokens: 20000,
        totalTokens: 70000,
      })
      expect(getTab(tabId)!.tokenUsage).not.toBeNull()

      // Clear the tab
      useSessionStore.getState().clearTab()

      const tab = getTab(tabId)!
      expect(tab.tokenUsage).toBeNull()
      expect(tab.contextNotificationShown).toBe(false)
    })
  })

  describe('context_management events', () => {
    it('adds a system message when context_management event is received', () => {
      const tabId = seedTab()
      dispatchEvent(tabId, {
        type: 'context_management',
        data: { action: 'compact', tokens_freed: 5000 },
      })

      const tab = getTab(tabId)!
      const systemMsgs = tab.messages.filter((m) => m.role === 'system')
      expect(systemMsgs).toHaveLength(1)
      expect(systemMsgs[0].content).toBe('Context auto-compacted by CLI')
    })
  })

  describe('proactive notification', () => {
    it('shows toast when token count exceeds 100k', () => {
      const tabId = seedTab()

      // Push tokens above 100k
      dispatchEvent(tabId, {
        type: 'token_usage',
        inputTokens: 80000,
        outputTokens: 25000,
        totalTokens: 105000,
      })

      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          title: 'Large context',
        }),
      )
    })

    it('does not show toast when token count is below 100k with no pruning savings', () => {
      const tabId = seedTab()

      dispatchEvent(tabId, {
        type: 'token_usage',
        inputTokens: 5000,
        outputTokens: 2000,
        totalTokens: 7000,
      })

      expect(mockAddToast).not.toHaveBeenCalled()
    })

    it('only shows notification once per session (guard)', () => {
      const tabId = seedTab()

      // First event over threshold
      dispatchEvent(tabId, {
        type: 'token_usage',
        inputTokens: 80000,
        outputTokens: 25000,
        totalTokens: 105000,
      })

      expect(mockAddToast).toHaveBeenCalledTimes(1)
      mockAddToast.mockClear()

      // Second event still over threshold
      dispatchEvent(tabId, {
        type: 'token_usage',
        inputTokens: 10000,
        outputTokens: 5000,
        totalTokens: 15000,
      })

      // Should NOT be called again — once-per-session guard
      expect(mockAddToast).not.toHaveBeenCalled()
      expect(getTab(tabId)!.contextNotificationShown).toBe(true)
    })

    it('resets notification guard when tab is cleared', () => {
      const tabId = seedTab()

      // Trigger notification
      dispatchEvent(tabId, {
        type: 'token_usage',
        inputTokens: 80000,
        outputTokens: 25000,
        totalTokens: 105000,
      })
      expect(getTab(tabId)!.contextNotificationShown).toBe(true)

      // Clear tab
      useSessionStore.getState().clearTab()
      expect(getTab(tabId)!.contextNotificationShown).toBe(false)

      // New tokens over threshold should trigger notification again
      mockAddToast.mockClear()
      dispatchEvent(tabId, {
        type: 'token_usage',
        inputTokens: 80000,
        outputTokens: 25000,
        totalTokens: 105000,
      })
      expect(mockAddToast).toHaveBeenCalledTimes(1)
    })

    it('formats token count as ~Xk in toast message', () => {
      const tabId = seedTab()

      dispatchEvent(tabId, {
        type: 'token_usage',
        inputTokens: 80000,
        outputTokens: 25000,
        totalTokens: 105000,
      })

      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('~105k'),
        }),
      )
    })
  })
})
