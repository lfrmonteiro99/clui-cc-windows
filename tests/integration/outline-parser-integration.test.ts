/**
 * ENRICH-006: Live Mini-TOC — Integration Tests
 *
 * Tests outline parsing from streaming text with headings.
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
import { parseOutline, detectStepProgress } from '../../src/shared/enrich/outline-parser'

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

describe('ENRICH-006: Live Mini-TOC Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parseOutline finds ## headers arriving via text_chunks', () => {
    const tabId = seedTab()

    dispatch(tabId, { type: 'text_chunk', text: '## Introduction\nSome intro text.\n' })
    dispatch(tabId, { type: 'text_chunk', text: '## Architecture\nDetails here.\n' })
    dispatch(tabId, { type: 'text_chunk', text: '## Conclusion\nWrap up.\n' })

    const tab = getTab(tabId)!
    const text = getMessageContent(tab.messages[0])
    const outline = parseOutline(text)

    expect(outline.length).toBe(3)
    expect(outline[0].text).toBe('Introduction')
    expect(outline[0].level).toBe(2)
    expect(outline[1].text).toBe('Architecture')
    expect(outline[2].text).toBe('Conclusion')
  })

  it('handles mixed heading levels (## and ###)', () => {
    const text = '## Overview\nText.\n### Sub-section A\nMore text.\n### Sub-section B\nEven more.\n## Next Part\nDone.'
    const outline = parseOutline(text)

    expect(outline.length).toBe(4)
    expect(outline[0]).toEqual(expect.objectContaining({ level: 2, text: 'Overview' }))
    expect(outline[1]).toEqual(expect.objectContaining({ level: 3, text: 'Sub-section A' }))
    expect(outline[2]).toEqual(expect.objectContaining({ level: 3, text: 'Sub-section B' }))
    expect(outline[3]).toEqual(expect.objectContaining({ level: 2, text: 'Next Part' }))
  })

  it('outline entries have correct offsets for scroll targeting', () => {
    const text = '# Title\n\nSome content here.\n\n## Section 1\nMore content.\n\n## Section 2\nEnd.'
    const outline = parseOutline(text)

    expect(outline.length).toBe(3)
    // Verify offsets point to the beginning of the heading line
    for (const entry of outline) {
      const foundText = text.substring(entry.offset, entry.offset + 20)
      expect(foundText).toContain('#')
    }
    // Offsets should be increasing
    expect(outline[1].offset).toBeGreaterThan(outline[0].offset)
    expect(outline[2].offset).toBeGreaterThan(outline[1].offset)
  })

  it('detectStepProgress estimates correctly as steps arrive', () => {
    // First two steps
    let text = '1. Install dependencies\n2. Configure the project\n'
    let progress = detectStepProgress(text)
    expect(progress.current).toBe(2)

    // More steps arrive
    text += '3. Run tests\n4. Deploy\n'
    progress = detectStepProgress(text)
    expect(progress.current).toBe(4)
  })

  it('detectStepProgress detects total from "N steps" mention', () => {
    const text = 'Follow these 5 steps:\n1. First\n2. Second\n3. Third\n'
    const progress = detectStepProgress(text)
    expect(progress.current).toBe(3)
    expect(progress.total).toBe(5)
  })

  it('detectStepProgress returns 0 for text without steps', () => {
    const progress = detectStepProgress('Just some regular text.')
    expect(progress.current).toBe(0)
    expect(progress.total).toBeNull()
  })

  it('parseOutline returns empty for text without headings', () => {
    const outline = parseOutline('Just plain text, no markdown headings here.')
    expect(outline).toEqual([])
  })
})
