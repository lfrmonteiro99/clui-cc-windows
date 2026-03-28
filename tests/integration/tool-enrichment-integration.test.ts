/**
 * ENRICH-005: Rich Tool Timeline — Integration Tests
 *
 * Tests enriched tool labels and file extraction from real store tool messages.
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
import { getEnrichedToolLabel, extractFilesFromTools } from '../../src/shared/enrich/tool-enrichment'

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

describe('ENRICH-005: Rich Tool Timeline Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('getEnrichedToolLabel returns filename for Read tool', () => {
    const tabId = seedTab()
    dispatch(tabId, { type: 'tool_call', toolName: 'Read', toolId: 't1', index: 0 })
    dispatch(tabId, { type: 'tool_call_update', toolId: 't1', partialInput: '{"file_path": "/src/utils/helper.ts"}' })
    dispatch(tabId, { type: 'tool_call_complete', index: 0 })

    const tab = getTab(tabId)!
    const toolMsg = tab.messages.find((m) => m.role === 'tool' && m.toolName === 'Read')!
    const label = getEnrichedToolLabel(toolMsg.toolName!, toolMsg.toolInput)
    expect(label).toBe('Read helper.ts')
  })

  it('getEnrichedToolLabel returns enriched label for Edit with file_path in JSON input', () => {
    const label = getEnrichedToolLabel('Edit', '{"file_path": "/home/user/src/index.ts", "old_string": "x", "new_string": "y"}')
    expect(label).toBe('Edit index.ts')
  })

  it('getEnrichedToolLabel truncates long Bash commands', () => {
    const longCmd = 'find /home/user/project -type f -name "*.ts" -exec grep -l "something very specific" {} \\; | head -20'
    const label = getEnrichedToolLabel('Bash', JSON.stringify({ command: longCmd }))
    expect(label.length).toBeLessThanOrEqual(67) // "Bash: " prefix + truncated command + "..."
    expect(label).toContain('...')
  })

  it('getEnrichedToolLabel handles short Bash commands', () => {
    const label = getEnrichedToolLabel('Bash', '{"command": "npm test"}')
    expect(label).toBe('Bash: npm test')
  })

  it('extractFilesFromTools collects unique files from multiple tool calls', () => {
    const tabId = seedTab()

    // Read /src/a.ts
    dispatch(tabId, { type: 'tool_call', toolName: 'Read', toolId: 't1', index: 0 })
    dispatch(tabId, { type: 'tool_call_update', toolId: 't1', partialInput: '{"file_path": "/src/a.ts"}' })
    dispatch(tabId, { type: 'tool_call_complete', index: 0 })

    // Edit /src/b.ts
    dispatch(tabId, { type: 'tool_call', toolName: 'Edit', toolId: 't2', index: 1 })
    dispatch(tabId, { type: 'tool_call_update', toolId: 't2', partialInput: '{"file_path": "/src/b.ts"}' })
    dispatch(tabId, { type: 'tool_call_complete', index: 1 })

    // Read /src/a.ts again (duplicate)
    dispatch(tabId, { type: 'tool_call', toolName: 'Read', toolId: 't3', index: 2 })
    dispatch(tabId, { type: 'tool_call_update', toolId: 't3', partialInput: '{"file_path": "/src/a.ts"}' })
    dispatch(tabId, { type: 'tool_call_complete', index: 2 })

    const tab = getTab(tabId)!
    const files = extractFilesFromTools(tab.messages)
    expect(files).toContain('/src/a.ts')
    expect(files).toContain('/src/b.ts')
    // Should be unique — /src/a.ts only once
    expect(files.length).toBe(2)
  })

  it('getEnrichedToolLabel returns plain name for unknown tools', () => {
    expect(getEnrichedToolLabel('CustomTool', '{"some": "data"}')).toBe('CustomTool')
  })

  it('getEnrichedToolLabel handles invalid JSON gracefully', () => {
    expect(getEnrichedToolLabel('Read', 'not json')).toBe('Read')
  })

  it('getEnrichedToolLabel returns tool name when no input', () => {
    expect(getEnrichedToolLabel('Read')).toBe('Read')
  })

  it('Glob tool shows pattern', () => {
    const label = getEnrichedToolLabel('Glob', '{"pattern": "**/*.ts"}')
    expect(label).toBe('Glob **/*.ts')
  })

  it('Grep tool shows pattern', () => {
    const label = getEnrichedToolLabel('Grep', '{"pattern": "TODO"}')
    expect(label).toBe('Grep "TODO"')
  })
})
