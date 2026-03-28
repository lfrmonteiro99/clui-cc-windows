/**
 * ENRICH-002: Content-Type Detection Badge — Integration Tests
 *
 * Tests the full flow: text_chunk with various content types → detection → activity label.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedEvent, TabState } from '../../src/shared/types'

// ── Mocks ──

const mockClui = vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>).Audio = class MockAudio {
    volume = 1.0; currentTime = 0; play = () => Promise.resolve(); pause = () => {}
  }
  if (!globalThis.crypto) {
    ;(globalThis as Record<string, unknown>).crypto = { randomUUID: () => '00000000-0000-0000-0000-000000000000' }
  }
  const clui = {
    isVisible: vi.fn().mockResolvedValue(true), recordCost: vi.fn(),
    sendDesktopNotification: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue({ version: '1.0', auth: null, projectPath: '~', homePath: '~' }),
    createTab: vi.fn().mockResolvedValue({ tabId: 'new-tab' }),
    closeTab: vi.fn().mockResolvedValue(undefined), prompt: vi.fn().mockResolvedValue(undefined),
    stopTab: vi.fn().mockResolvedValue(undefined), retry: vi.fn().mockResolvedValue(undefined),
    initSession: vi.fn().mockResolvedValue(undefined), resetTabSession: vi.fn(),
    respondPermission: vi.fn().mockResolvedValue(true), setPermissionMode: vi.fn(),
    loadSession: vi.fn().mockResolvedValue([]),
    getAutoAttachConfig: vi.fn().mockResolvedValue({ attachments: [], warnings: [] }),
  }
  ;(globalThis as Record<string, unknown>).window = {
    ...((globalThis as Record<string, unknown>).window || {}), clui,
    localStorage: { getItem: () => null, setItem: () => {} },
  }
  return clui
})

vi.mock('../../src/renderer/theme', () => ({
  useThemeStore: { getState: () => ({ soundEnabled: false, autoResumeEnabled: false, autoResumeMaxRetries: 3 }), setState: vi.fn(), subscribe: vi.fn() },
}))
vi.mock('../../src/renderer/stores/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ desktopEnabled: false, addToast: vi.fn() }), setState: vi.fn(), subscribe: vi.fn() },
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
import { detectContentType, throttledDetect } from '../../src/shared/enrich/content-detect'

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

describe('ENRICH-002: Content-Type Detection Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('detects code fence content and sets currentActivity to Writing...', () => {
    const tabId = seedTab()
    dispatch(tabId, { type: 'text_chunk', text: 'Here is code:\n```typescript\nconst x = 1;\n```' })

    const tab = getTab(tabId)!
    // Store sets activity to 'Writing...' on text_chunk
    expect(tab.currentActivity).toBe('Writing...')

    // Content detection on the accumulated text
    const text = getMessageContent(tab.messages[0])
    const detection = detectContentType(text)
    expect(detection.type).toBe('code')
    expect(detection.label).toBe('Writing code...')
  })

  it('detects numbered list and reports step count', () => {
    const tabId = seedTab()
    dispatch(tabId, { type: 'text_chunk', text: '1. First step\n2. Second step\n3. Third step' })

    const tab = getTab(tabId)!
    const text = getMessageContent(tab.messages[0])
    const detection = detectContentType(text)
    expect(detection.type).toBe('list')
    expect(detection.label).toBe('Listing steps (3)...')
  })

  it('detects table markdown', () => {
    const tabId = seedTab()
    dispatch(tabId, { type: 'text_chunk', text: '| Name | Age |\n|------|-----|\n| Alice | 30 |' })

    const tab = getTab(tabId)!
    const text = getMessageContent(tab.messages[0])
    const detection = detectContentType(text)
    expect(detection.type).toBe('table')
    expect(detection.label).toBe('Generating table...')
  })

  it('detects headers as structuring response', () => {
    const tabId = seedTab()
    dispatch(tabId, { type: 'text_chunk', text: '## Architecture Overview\nSome explanation here.' })

    const tab = getTab(tabId)!
    const text = getMessageContent(tab.messages[0])
    const detection = detectContentType(text)
    expect(detection.type).toBe('structure')
    expect(detection.label).toBe('Structuring response...')
  })

  it('throttledDetect only runs on interval multiples', () => {
    const text = '```js\ncode\n```'
    // chunk 0 — runs
    expect(throttledDetect(text, 0, 5)).not.toBeNull()
    // chunks 1-4 — skipped
    expect(throttledDetect(text, 1, 5)).toBeNull()
    expect(throttledDetect(text, 2, 5)).toBeNull()
    expect(throttledDetect(text, 3, 5)).toBeNull()
    expect(throttledDetect(text, 4, 5)).toBeNull()
    // chunk 5 — runs
    expect(throttledDetect(text, 5, 5)).not.toBeNull()
  })

  it('defaults to prose for plain text', () => {
    const detection = detectContentType('Just some normal text without special formatting.')
    expect(detection.type).toBe('prose')
    expect(detection.label).toBe('Writing...')
  })
})
