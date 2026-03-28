/**
 * ENRICH-004: Clickable References — Integration Tests
 *
 * Tests reference detection on text from real store state.
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
import { detectReferences } from '../../src/shared/enrich/reference-detect'

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

describe('ENRICH-004: Clickable References Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('detects URL in streamed text', () => {
    const tabId = seedTab()
    dispatch(tabId, { type: 'text_chunk', text: 'Check https://github.com/example/repo for details.' })

    const tab = getTab(tabId)!
    const text = getMessageContent(tab.messages[0])
    const refs = detectReferences(text)

    expect(refs.length).toBeGreaterThanOrEqual(1)
    const urlRef = refs.find((r) => r.type === 'url')
    expect(urlRef).toBeDefined()
    expect(urlRef!.value).toBe('https://github.com/example/repo')
  })

  it('detects file path in prose', () => {
    const tabId = seedTab()
    dispatch(tabId, { type: 'text_chunk', text: 'The config is at /home/user/project/config.json now.' })

    const tab = getTab(tabId)!
    const text = getMessageContent(tab.messages[0])
    const refs = detectReferences(text)

    const fileRef = refs.find((r) => r.type === 'file')
    expect(fileRef).toBeDefined()
    expect(fileRef!.value).toBe('/home/user/project/config.json')
  })

  it('detects GitHub ref #123', () => {
    const tabId = seedTab()
    dispatch(tabId, { type: 'text_chunk', text: 'This fixes #123 and relates to #456.' })

    const tab = getTab(tabId)!
    const text = getMessageContent(tab.messages[0])
    const refs = detectReferences(text)

    const githubRefs = refs.filter((r) => r.type === 'github')
    expect(githubRefs.length).toBe(2)
    expect(githubRefs[0].value).toBe('#123')
    expect(githubRefs[1].value).toBe('#456')
  })

  it('detects hex color without confusing it with GitHub ref', () => {
    const tabId = seedTab()
    dispatch(tabId, { type: 'text_chunk', text: 'Use color #ff0000 for errors and #00ff00 for success.' })

    const tab = getTab(tabId)!
    const text = getMessageContent(tab.messages[0])
    const refs = detectReferences(text)

    const colorRefs = refs.filter((r) => r.type === 'color')
    expect(colorRefs.length).toBe(2)
    expect(colorRefs[0].value).toBe('#ff0000')
    expect(colorRefs[1].value).toBe('#00ff00')

    // No github refs for hex colors
    const githubRefs = refs.filter((r) => r.type === 'github')
    expect(githubRefs.length).toBe(0)
  })

  it('handles mixed content with multiple reference types', () => {
    const tabId = seedTab()
    dispatch(tabId, {
      type: 'text_chunk',
      text: 'See https://docs.example.com and /usr/local/bin/app.sh for #42. Color: #aabbcc',
    })

    const tab = getTab(tabId)!
    const text = getMessageContent(tab.messages[0])
    const refs = detectReferences(text)

    const types = refs.map((r) => r.type)
    expect(types).toContain('url')
    expect(types).toContain('file')
    // #42 should be github, #aabbcc should be color
    expect(refs.find((r) => r.type === 'github')?.value).toBe('#42')
    expect(refs.find((r) => r.type === 'color')?.value).toBe('#aabbcc')
  })

  it('returns empty for text with no references', () => {
    const refs = detectReferences('Just plain text with nothing special.')
    expect(refs).toEqual([])
  })

  it('references are sorted by start position', () => {
    const refs = detectReferences('First #1 then https://example.com then /tmp/file.txt')
    for (let i = 1; i < refs.length; i++) {
      expect(refs[i].start).toBeGreaterThanOrEqual(refs[i - 1].start)
    }
  })
})
