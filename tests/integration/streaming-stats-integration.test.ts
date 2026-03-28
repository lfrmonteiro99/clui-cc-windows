/**
 * ENRICH-001: Streaming Stats Bar — Integration Tests
 *
 * Tests the full flow: text_chunk events arrive → store processes them →
 * streaming stats compute correctly from real store state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedEvent, TabState } from '../../src/shared/types'

// ── Mocks (must be set before store import) ──

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
    localStorage: { getItem: () => null, setItem: () => {} },
  }
  return clui
})

vi.mock('../../src/renderer/theme', () => ({
  useThemeStore: {
    getState: () => ({ soundEnabled: false, autoResumeEnabled: false, autoResumeMaxRetries: 3 }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))
vi.mock('../../src/renderer/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: () => ({ desktopEnabled: false, addToast: vi.fn() }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))
vi.mock('../../src/renderer/stores/marketplaceStore', () => ({
  useMarketplaceStore: { getState: () => ({ closeMarketplace: vi.fn() }), setState: vi.fn(), subscribe: vi.fn() },
}))
vi.mock('../../src/renderer/stores/permissionStore', () => ({
  usePermissionStore: { getState: () => ({ setPermissionMode: vi.fn(), respondPermission: vi.fn() }), setState: vi.fn(), subscribe: vi.fn() },
}))
vi.mock('../../src/renderer/stores/agentMemoryStore', () => ({
  useAgentMemoryStore: {
    getState: () => ({ refreshAgentMemory: vi.fn().mockResolvedValue(null), setAgentFocus: vi.fn().mockResolvedValue(null), claimAgentWork: vi.fn().mockResolvedValue(null), markAgentDone: vi.fn().mockResolvedValue(false), releaseAgentWork: vi.fn().mockResolvedValue(false) }),
    setState: vi.fn(), subscribe: vi.fn(),
  },
}))
vi.mock('../../../resources/notification.mp3', () => ({ default: 'mock.mp3' }))

import { useSessionStore, getMessageContent } from '../../src/renderer/stores/sessionStore.impl'
import { computeWordCount, computeCharCount, estimateCost, computeStreamingStats } from '../../src/shared/enrich/streaming-stats'

// ── Helpers ──

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'test-tab', claudeSessionId: null, status: 'idle', activeRequestId: null,
    hasUnread: false, currentActivity: '', permissionQueue: [], permissionDenied: null,
    retryState: null, agentAssignment: null, lastRunOptions: null, queuedRunOptions: [],
    attachments: [], messages: [], title: 'Test Tab', lastResult: null,
    sessionModel: null, sessionTools: [], sessionMcpServers: [], sessionSkills: [],
    sessionVersion: null, queuedPrompts: [], workingDirectory: '~',
    hasChosenDirectory: false, additionalDirs: [], runtime: 'native', wslDistro: null,
    lastActivityAt: 0, sandboxState: { enabled: false, activeWorktree: null, pendingDiff: null, mergeStatus: 'idle' as const },
    tokenUsage: null, contextNotificationShown: false,
    ...overrides,
  }
}

function seedTab(overrides: Partial<TabState> = {}): string {
  const tab = makeTab(overrides)
  useSessionStore.setState({ tabs: [tab], tabOrder: [tab.id], activeTabId: tab.id })
  return tab.id
}

function dispatch(tabId: string, event: NormalizedEvent): void {
  useSessionStore.getState().handleNormalizedEvent(tabId, event)
}

function getTab(tabId = 'test-tab'): TabState | undefined {
  return useSessionStore.getState().tabs.find((t) => t.id === tabId)
}

// ── Tests ──

describe('ENRICH-001: Streaming Stats Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accumulates text_chunk events and computes word count from _textChunks', () => {
    const tabId = seedTab()

    // Send text chunks
    dispatch(tabId, { type: 'text_chunk', text: 'Hello world ' })
    dispatch(tabId, { type: 'text_chunk', text: 'this is a test ' })
    dispatch(tabId, { type: 'text_chunk', text: 'of streaming stats.' })

    const tab = getTab(tabId)!
    expect(tab.messages.length).toBe(1)
    expect(tab.messages[0].role).toBe('assistant')
    expect(tab.messages[0]._textChunks).toBeDefined()
    expect(tab.messages[0]._textChunks!.length).toBe(3)

    // Compute word count from the store's messages
    const wordCount = computeWordCount(tab.messages)
    expect(wordCount).toBe(9) // "Hello world this is a test of streaming stats."

    const charCount = computeCharCount(tab.messages)
    expect(charCount).toBeGreaterThan(0)
  })

  it('token_usage event updates tab.tokenUsage and cost estimate computes', () => {
    const tabId = seedTab()

    dispatch(tabId, {
      type: 'token_usage',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
    })

    const tab = getTab(tabId)!
    expect(tab.tokenUsage).not.toBeNull()
    expect(tab.tokenUsage!.inputTokens).toBe(1000)
    expect(tab.tokenUsage!.outputTokens).toBe(500)
    expect(tab.tokenUsage!.totalTokens).toBe(1500)
    expect(tab.tokenUsage!.cacheReadTokens).toBe(200)
    expect(tab.tokenUsage!.cacheWriteTokens).toBe(100)

    const cost = estimateCost(tab.tokenUsage)
    expect(cost).not.toBeNull()
    expect(cost!).toBeGreaterThan(0)
  })

  it('token_usage accumulates across multiple events', () => {
    const tabId = seedTab()

    dispatch(tabId, { type: 'token_usage', inputTokens: 500, outputTokens: 200, totalTokens: 700 })
    dispatch(tabId, { type: 'token_usage', inputTokens: 300, outputTokens: 100, totalTokens: 400 })

    const tab = getTab(tabId)!
    expect(tab.tokenUsage!.inputTokens).toBe(800)
    expect(tab.tokenUsage!.outputTokens).toBe(300)
    expect(tab.tokenUsage!.totalTokens).toBe(1100)
  })

  it('task_complete hides stats bar data (status no longer running)', () => {
    const tabId = seedTab({ status: 'running' })

    dispatch(tabId, { type: 'text_chunk', text: 'Some output' })

    let tab = getTab(tabId)!
    expect(tab.status).toBe('running')
    expect(tab.currentActivity).toBe('Writing...')

    dispatch(tabId, {
      type: 'task_complete',
      result: 'done',
      costUsd: 0.01,
      durationMs: 5000,
      numTurns: 1,
      usage: { input_tokens: 100, output_tokens: 50 },
      sessionId: 'ses-1',
    })

    tab = getTab(tabId)!
    expect(tab.status).toBe('completed')
    expect(tab.currentActivity).toBe('')
  })

  it('computeStreamingStats returns full snapshot', () => {
    const tabId = seedTab()
    dispatch(tabId, { type: 'text_chunk', text: 'Hello world ' })
    dispatch(tabId, { type: 'text_chunk', text: 'test' })
    dispatch(tabId, { type: 'token_usage', inputTokens: 100, outputTokens: 50, totalTokens: 150 })

    const tab = getTab(tabId)!
    const stats = computeStreamingStats(tab.messages, tab.tokenUsage)
    expect(stats.wordCount).toBe(3)
    expect(stats.charCount).toBe(16)
    expect(stats.estimatedCostUsd).not.toBeNull()
  })

  it('estimateCost returns null when no usage data', () => {
    expect(estimateCost(null)).toBeNull()
  })
})
