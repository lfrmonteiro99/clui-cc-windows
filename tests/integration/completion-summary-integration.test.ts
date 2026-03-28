/**
 * ENRICH-003: Completion Summary Card — Integration Tests
 *
 * Tests: session_init → text_chunk → tool_call → tool_call_complete → task_complete
 * then verifies summary extraction from real store state.
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

import { useSessionStore } from '../../src/renderer/stores/sessionStore.impl'
import { extractCodeBlocks, extractFilesTouched, countToolCalls } from '../../src/shared/enrich/completion-summary'

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

describe('ENRICH-003: Completion Summary Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('full session flow: init → text → tool → complete → summary data', () => {
    const tabId = seedTab()

    // 1. session_init
    dispatch(tabId, {
      type: 'session_init', sessionId: 'ses-sum',
      model: 'claude-sonnet-4-6', tools: ['Read', 'Edit', 'Bash'],
      mcpServers: [], skills: [], version: '2.1.0',
    })

    // 2. text_chunk with code
    dispatch(tabId, { type: 'text_chunk', text: 'Here is the fix:\n```typescript\nconst x = 42;\n```\n' })

    // 3. tool_call
    dispatch(tabId, { type: 'tool_call', toolName: 'Edit', toolId: 't1', index: 0 })
    dispatch(tabId, { type: 'tool_call_update', toolId: 't1', partialInput: '{"file_path": "/src/main.ts"}' })
    dispatch(tabId, { type: 'tool_call_complete', index: 0 })

    // 4. Another tool_call
    dispatch(tabId, { type: 'tool_call', toolName: 'Bash', toolId: 't2', index: 1 })
    dispatch(tabId, { type: 'tool_call_complete', index: 1 })

    // 5. task_complete
    dispatch(tabId, {
      type: 'task_complete', result: 'done', costUsd: 0.023, durationMs: 12000,
      numTurns: 3, usage: { input_tokens: 2000, output_tokens: 500 }, sessionId: 'ses-sum',
    })

    const tab = getTab(tabId)!

    // Verify lastResult
    expect(tab.lastResult).not.toBeNull()
    expect(tab.lastResult!.totalCostUsd).toBe(0.023)
    expect(tab.lastResult!.durationMs).toBe(12000)
    expect(tab.lastResult!.numTurns).toBe(3)

    // Extract code blocks from messages
    const codeBlocks = extractCodeBlocks(tab.messages)
    expect(codeBlocks.length).toBe(1)
    expect(codeBlocks[0].language).toBe('typescript')
    expect(codeBlocks[0].code).toContain('const x = 42')

    // Extract files touched
    const files = extractFilesTouched(tab.messages)
    expect(files).toContain('/src/main.ts')

    // Count tool calls
    const toolCount = countToolCalls(tab.messages)
    expect(toolCount).toBe(2)
  })

  it('extractCodeBlocks handles multiple code blocks in one message', () => {
    const tabId = seedTab()
    dispatch(tabId, {
      type: 'text_chunk',
      text: '```python\nprint("hello")\n```\nAnd also:\n```javascript\nconsole.log("world")\n```',
    })

    // Flush chunks via task_complete
    dispatch(tabId, {
      type: 'task_complete', result: 'done', costUsd: 0, durationMs: 0,
      numTurns: 1, usage: { input_tokens: 0, output_tokens: 0 }, sessionId: 'ses-2',
    })

    const tab = getTab(tabId)!
    const blocks = extractCodeBlocks(tab.messages)
    expect(blocks.length).toBe(2)
    expect(blocks[0].language).toBe('python')
    expect(blocks[1].language).toBe('javascript')
  })

  it('extractFilesTouched finds paths from tool input JSON', () => {
    const tabId = seedTab()
    dispatch(tabId, { type: 'tool_call', toolName: 'Read', toolId: 't1', index: 0 })
    dispatch(tabId, { type: 'tool_call_update', toolId: 't1', partialInput: '{"file_path": "/home/user/app.ts"}' })
    dispatch(tabId, { type: 'tool_call_complete', index: 0 })

    dispatch(tabId, { type: 'tool_call', toolName: 'Write', toolId: 't2', index: 1 })
    dispatch(tabId, { type: 'tool_call_update', toolId: 't2', partialInput: '{"file_path": "/home/user/config.json"}' })
    dispatch(tabId, { type: 'tool_call_complete', index: 1 })

    const tab = getTab(tabId)!
    const files = extractFilesTouched(tab.messages)
    expect(files).toContain('/home/user/app.ts')
    expect(files).toContain('/home/user/config.json')
  })

  it('countToolCalls returns 0 for no tool messages', () => {
    const tabId = seedTab()
    dispatch(tabId, { type: 'text_chunk', text: 'Just text, no tools.' })
    const tab = getTab(tabId)!
    expect(countToolCalls(tab.messages)).toBe(0)
  })
})
