import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedEvent, TabState, Message } from '../../src/shared/types'

// vi.hoisted runs before vi.mock factories — define Audio and window.clui
// here so the module-level `new Audio(...)` and initial store creation
// inside sessionStore.impl.ts succeed.
const mockClui = vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>).Audio = class MockAudio {
    volume = 1.0
    currentTime = 0
    play = () => Promise.resolve()
    pause = () => {}
  }
  // crypto.randomUUID is needed by makeLocalTab at module init
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

// ─── Mock dependent modules before importing the store ───

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

// Shared addToast spy — accessible in tests to assert toast calls
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

// Mock the mp3 import
vi.mock('../../../resources/notification.mp3', () => ({
  default: 'mock-notification.mp3',
}))

// Now import the store — modules are already mocked
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

describe('handleNormalizedEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store to a known state with a single tab
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

  // ─── session_init ───

  describe('session_init', () => {
    it('sets session metadata fields on the tab', () => {
      const tabId = seedTab()
      dispatchEvent(tabId, {
        type: 'session_init',
        sessionId: 'ses-123',
        model: 'claude-opus-4-6',
        tools: ['Read', 'Write', 'Bash'],
        mcpServers: [{ name: 'mcp1', status: 'connected' }],
        skills: ['code-review'],
        version: '2.1.63',
      })

      const tab = getTab(tabId)!
      expect(tab.claudeSessionId).toBe('ses-123')
      expect(tab.sessionModel).toBe('claude-opus-4-6')
      expect(tab.sessionTools).toEqual(['Read', 'Write', 'Bash'])
      expect(tab.sessionMcpServers).toEqual([{ name: 'mcp1', status: 'connected' }])
      expect(tab.sessionSkills).toEqual(['code-review'])
      expect(tab.sessionVersion).toBe('2.1.63')
    })

    it('sets status to running and activity to Thinking', () => {
      const tabId = seedTab({ status: 'connecting' })
      dispatchEvent(tabId, {
        type: 'session_init',
        sessionId: 'ses-1',
        model: 'claude-sonnet-4-6',
        tools: [],
        mcpServers: [],
        skills: [],
        version: '2.1.0',
      })

      const tab = getTab(tabId)!
      expect(tab.status).toBe('running')
      expect(tab.currentActivity).toBe('Thinking...')
    })

    it('does not change status when isWarmup is true', () => {
      const tabId = seedTab({ status: 'connecting' })
      dispatchEvent(tabId, {
        type: 'session_init',
        sessionId: 'ses-warm',
        model: 'claude-haiku-4-5-20251001',
        tools: [],
        mcpServers: [],
        skills: [],
        version: '2.1.0',
        isWarmup: true,
      })

      const tab = getTab(tabId)!
      expect(tab.status).toBe('connecting')
      expect(tab.claudeSessionId).toBe('ses-warm')
    })

    it('dequeues first queued prompt into messages', () => {
      const tabId = seedTab({
        queuedPrompts: ['queued message 1', 'queued message 2'],
        queuedRunOptions: [
          { prompt: 'queued message 1', projectPath: '~' },
          { prompt: 'queued message 2', projectPath: '~' },
        ],
      })

      dispatchEvent(tabId, {
        type: 'session_init',
        sessionId: 'ses-q',
        model: 'claude-opus-4-6',
        tools: [],
        mcpServers: [],
        skills: [],
        version: '2.1.0',
      })

      const tab = getTab(tabId)!
      expect(tab.queuedPrompts).toEqual(['queued message 2'])
      expect(tab.queuedRunOptions).toHaveLength(1)
      // The dequeued prompt should become the last user message
      const lastUserMsg = tab.messages.filter((m) => m.role === 'user').pop()
      expect(lastUserMsg?.content).toBe('queued message 1')
      // lastRunOptions should be updated to the dequeued options
      expect(tab.lastRunOptions?.prompt).toBe('queued message 1')
    })

    it('does not dequeue prompts when isWarmup is true', () => {
      const tabId = seedTab({
        queuedPrompts: ['queued'],
        queuedRunOptions: [{ prompt: 'queued', projectPath: '~' }],
      })

      dispatchEvent(tabId, {
        type: 'session_init',
        sessionId: 'ses-w2',
        model: 'claude-opus-4-6',
        tools: [],
        mcpServers: [],
        skills: [],
        version: '2.1.0',
        isWarmup: true,
      })

      const tab = getTab(tabId)!
      expect(tab.queuedPrompts).toEqual(['queued'])
    })
  })

  // ─── text_chunk ───

  describe('text_chunk', () => {
    it('creates a new assistant message when no existing assistant message', () => {
      const tabId = seedTab()
      dispatchEvent(tabId, { type: 'text_chunk', text: 'Hello' })

      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(1)
      expect(tab.messages[0].role).toBe('assistant')
      expect(getMessageContent(tab.messages[0])).toBe('Hello')
      expect(tab.currentActivity).toBe('Writing...')
    })

    it('appends text to the last assistant message', () => {
      const tabId = seedTab({
        messages: [{ id: 'msg-1', role: 'assistant', content: 'Hello ', timestamp: Date.now() }],
      })

      dispatchEvent(tabId, { type: 'text_chunk', text: 'World' })

      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(1)
      expect(getMessageContent(tab.messages[0])).toBe('Hello World')
    })

    it('creates new assistant message when last message is a tool message', () => {
      const tabId = seedTab({
        messages: [
          { id: 'msg-1', role: 'tool', content: '', toolName: 'Read', toolStatus: 'completed', timestamp: Date.now() },
        ],
      })

      dispatchEvent(tabId, { type: 'text_chunk', text: 'After tool' })

      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(2)
      expect(tab.messages[1].role).toBe('assistant')
      expect(getMessageContent(tab.messages[1])).toBe('After tool')
    })

    it('creates new assistant message when last message is an assistant message with toolName', () => {
      const tabId = seedTab({
        messages: [
          { id: 'msg-1', role: 'assistant', content: 'tool output', toolName: 'Bash', timestamp: Date.now() },
        ],
      })

      dispatchEvent(tabId, { type: 'text_chunk', text: 'new text' })

      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(2)
      expect(getMessageContent(tab.messages[1])).toBe('new text')
    })

    it('accumulates multiple text chunks into a single message', () => {
      const tabId = seedTab()

      dispatchEvent(tabId, { type: 'text_chunk', text: 'Part 1' })
      dispatchEvent(tabId, { type: 'text_chunk', text: ' Part 2' })
      dispatchEvent(tabId, { type: 'text_chunk', text: ' Part 3' })

      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(1)
      expect(getMessageContent(tab.messages[0])).toBe('Part 1 Part 2 Part 3')
    })
  })

  // ─── tool_call ───

  describe('tool_call', () => {
    it('adds a tool message with running status', () => {
      const tabId = seedTab()
      dispatchEvent(tabId, { type: 'tool_call', toolName: 'Read', toolId: 'tool-1', index: 0 })

      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(1)
      const msg = tab.messages[0]
      expect(msg.role).toBe('tool')
      expect(msg.toolName).toBe('Read')
      expect(msg.toolStatus).toBe('running')
      expect(msg.content).toBe('')
      expect(msg.toolInput).toBe('')
    })

    it('sets activity to Running {toolName}...', () => {
      const tabId = seedTab()
      dispatchEvent(tabId, { type: 'tool_call', toolName: 'Bash', toolId: 'tool-2', index: 0 })

      const tab = getTab(tabId)!
      expect(tab.currentActivity).toBe('Running Bash...')
    })
  })

  // ─── tool_call_update ───

  describe('tool_call_update', () => {
    it('appends partialInput to the last running tool message', () => {
      const tabId = seedTab({
        messages: [
          { id: 'msg-1', role: 'tool', content: '', toolName: 'Bash', toolInput: '', toolStatus: 'running', timestamp: Date.now() },
        ],
      })

      dispatchEvent(tabId, { type: 'tool_call_update', toolId: 'tool-1', partialInput: '{"command":' })
      dispatchEvent(tabId, { type: 'tool_call_update', toolId: 'tool-1', partialInput: ' "ls"}' })

      const tab = getTab(tabId)!
      expect(tab.messages[0].toolInput).toBe('{"command": "ls"}')
    })

    it('does not crash when there is no running tool message', () => {
      const tabId = seedTab({
        messages: [
          { id: 'msg-1', role: 'assistant', content: 'text', timestamp: Date.now() },
        ],
      })

      // Should not throw
      dispatchEvent(tabId, { type: 'tool_call_update', toolId: 'tool-x', partialInput: 'data' })

      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(1)
      expect(tab.messages[0].content).toBe('text')
    })

    it('targets the last running tool when multiple tools exist', () => {
      const tabId = seedTab({
        messages: [
          { id: 'msg-1', role: 'tool', content: '', toolName: 'Read', toolInput: 'done', toolStatus: 'completed', timestamp: Date.now() },
          { id: 'msg-2', role: 'tool', content: '', toolName: 'Write', toolInput: '', toolStatus: 'running', timestamp: Date.now() },
        ],
      })

      dispatchEvent(tabId, { type: 'tool_call_update', toolId: 'tool-2', partialInput: 'new data' })

      const tab = getTab(tabId)!
      expect(tab.messages[0].toolInput).toBe('done')
      expect(tab.messages[1].toolInput).toBe('new data')
    })
  })

  // ─── tool_call_complete ───

  describe('tool_call_complete', () => {
    it('sets the last running tool status to completed', () => {
      const tabId = seedTab({
        messages: [
          { id: 'msg-1', role: 'tool', content: '', toolName: 'Bash', toolInput: '{}', toolStatus: 'running', timestamp: Date.now() },
        ],
      })

      dispatchEvent(tabId, { type: 'tool_call_complete', index: 0 })

      const tab = getTab(tabId)!
      expect(tab.messages[0].toolStatus).toBe('completed')
    })

    it('completes only the last running tool when multiple exist', () => {
      const tabId = seedTab({
        messages: [
          { id: 'msg-1', role: 'tool', content: '', toolName: 'Read', toolInput: '', toolStatus: 'running', timestamp: Date.now() },
          { id: 'msg-2', role: 'tool', content: '', toolName: 'Write', toolInput: '', toolStatus: 'running', timestamp: Date.now() },
        ],
      })

      dispatchEvent(tabId, { type: 'tool_call_complete', index: 1 })

      const tab = getTab(tabId)!
      // The reverse search finds msg-2 (the last running tool)
      expect(tab.messages[1].toolStatus).toBe('completed')
      expect(tab.messages[0].toolStatus).toBe('running')
    })

    it('does not crash when no running tool exists', () => {
      const tabId = seedTab()
      // Should not throw
      dispatchEvent(tabId, { type: 'tool_call_complete', index: 0 })
      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(0)
    })
  })

  // ─── task_update ───

  describe('task_update', () => {
    it('adds tool_use blocks from message content as completed tool messages', () => {
      const tabId = seedTab()
      dispatchEvent(tabId, {
        type: 'task_update',
        message: {
          model: 'claude-opus-4-6',
          id: 'msg-api-1',
          role: 'assistant',
          content: [
            { type: 'tool_use', name: 'Read', id: 'tu-1', input: { path: '/foo' } },
          ],
          stop_reason: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      })

      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(1)
      expect(tab.messages[0].role).toBe('tool')
      expect(tab.messages[0].toolName).toBe('Read')
      expect(tab.messages[0].toolStatus).toBe('completed')
      expect(tab.messages[0].toolInput).toContain('/foo')
    })

    it('does not duplicate tool messages that already exist with the same name and empty content', () => {
      const tabId = seedTab({
        messages: [
          { id: 'msg-1', role: 'tool', content: '', toolName: 'Read', toolStatus: 'running', timestamp: Date.now() },
        ],
      })

      dispatchEvent(tabId, {
        type: 'task_update',
        message: {
          model: 'claude-opus-4-6',
          id: 'msg-api-2',
          role: 'assistant',
          content: [
            { type: 'tool_use', name: 'Read', id: 'tu-2', input: { path: '/bar' } },
          ],
          stop_reason: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      })

      const tab = getTab(tabId)!
      // Should NOT add a duplicate — the existing one with empty content and same name should match
      expect(tab.messages).toHaveLength(1)
    })

    it('skips non-tool_use content blocks', () => {
      const tabId = seedTab()
      dispatchEvent(tabId, {
        type: 'task_update',
        message: {
          model: 'claude-opus-4-6',
          id: 'msg-api-3',
          role: 'assistant',
          content: [
            { type: 'text', text: 'some text' },
          ],
          stop_reason: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      })

      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(0)
    })

    it('handles null/missing message content gracefully', () => {
      const tabId = seedTab()
      dispatchEvent(tabId, {
        type: 'task_update',
        message: {
          model: 'claude-opus-4-6',
          id: 'msg-api-4',
          role: 'assistant',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })

      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(0)
    })
  })

  // ─── task_complete ───

  describe('task_complete', () => {
    const baseTaskComplete: NormalizedEvent = {
      type: 'task_complete',
      result: 'Done',
      costUsd: 0.0523,
      durationMs: 15000,
      numTurns: 3,
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 50,
      },
      sessionId: 'ses-done',
    }

    it('sets status to completed and clears activeRequestId', () => {
      const tabId = seedTab({ status: 'running', activeRequestId: 'req-1' })
      dispatchEvent(tabId, baseTaskComplete)

      const tab = getTab(tabId)!
      expect(tab.status).toBe('completed')
      expect(tab.activeRequestId).toBeNull()
      expect(tab.currentActivity).toBe('')
    })

    it('clears permissionQueue and retryState', () => {
      const tabId = seedTab({
        status: 'running',
        permissionQueue: [{ questionId: 'q1', toolTitle: 'Bash', options: [] }],
        retryState: { isRetrying: true, attempt: 1, maxAttempts: 3, nextRetryAt: null },
      })
      dispatchEvent(tabId, baseTaskComplete)

      const tab = getTab(tabId)!
      expect(tab.permissionQueue).toEqual([])
      expect(tab.retryState).toBeNull()
    })

    it('records lastResult with cost, duration, turns, usage, sessionId', () => {
      const tabId = seedTab({ status: 'running' })
      dispatchEvent(tabId, baseTaskComplete)

      const tab = getTab(tabId)!
      expect(tab.lastResult).toEqual({
        totalCostUsd: 0.0523,
        durationMs: 15000,
        numTurns: 3,
        usage: baseTaskComplete.type === 'task_complete' ? baseTaskComplete.usage : {},
        sessionId: 'ses-done',
      })
    })

    it('calls window.clui.recordCost with correct data', () => {
      const tabId = seedTab({ status: 'running', sessionModel: 'claude-opus-4-6', workingDirectory: '/project' })
      dispatchEvent(tabId, baseTaskComplete)

      expect(mockClui.recordCost).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'ses-done',
          model: 'claude-opus-4-6',
          projectPath: '/project',
          costUsd: 0.0523,
          durationMs: 15000,
          numTurns: 3,
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 200,
          cacheCreationTokens: 50,
        }),
      )
    })

    it('marks tab as unread when it is not the active expanded tab', () => {
      const tabId = seedTab({ status: 'running' })
      useSessionStore.setState({ isExpanded: false })
      dispatchEvent(tabId, baseTaskComplete)

      const tab = getTab(tabId)!
      expect(tab.hasUnread).toBe(true)
    })

    it('does not mark as unread when tab is the active expanded tab', () => {
      const tabId = seedTab({ status: 'running' })
      useSessionStore.setState({ activeTabId: tabId, isExpanded: true })
      dispatchEvent(tabId, baseTaskComplete)

      const tab = getTab(tabId)!
      expect(tab.hasUnread).toBe(false)
    })

    it('marks as unread when tab is active but collapsed', () => {
      const tabId = seedTab({ status: 'running' })
      useSessionStore.setState({ activeTabId: tabId, isExpanded: false })
      dispatchEvent(tabId, baseTaskComplete)

      const tab = getTab(tabId)!
      expect(tab.hasUnread).toBe(true)
    })

    it('sets permissionDenied when permissionDenials are present', () => {
      const tabId = seedTab({ status: 'running' })
      const event: NormalizedEvent = {
        ...baseTaskComplete,
        type: 'task_complete',
        permissionDenials: [
          { toolName: 'Bash', toolUseId: 'tu-1' },
          { toolName: 'Write', toolUseId: 'tu-2' },
        ],
      }
      dispatchEvent(tabId, event)

      const tab = getTab(tabId)!
      expect(tab.permissionDenied).toEqual({
        tools: [
          { toolName: 'Bash', toolUseId: 'tu-1' },
          { toolName: 'Write', toolUseId: 'tu-2' },
        ],
      })
    })

    it('clears permissionDenied when no permissionDenials', () => {
      const tabId = seedTab({
        status: 'running',
        permissionDenied: { tools: [{ toolName: 'Bash', toolUseId: 'tu-old' }] },
      })
      dispatchEvent(tabId, baseTaskComplete)

      const tab = getTab(tabId)!
      expect(tab.permissionDenied).toBeNull()
    })
  })

  // ─── error ───

  describe('error', () => {
    it('sets status to failed and adds a system error message', () => {
      const tabId = seedTab({ status: 'running', activeRequestId: 'req-1' })
      dispatchEvent(tabId, {
        type: 'error',
        message: 'Something went wrong',
        isError: true,
      })

      const tab = getTab(tabId)!
      expect(tab.status).toBe('failed')
      expect(tab.activeRequestId).toBeNull()
      expect(tab.currentActivity).toBe('')
      expect(tab.permissionQueue).toEqual([])
      expect(tab.messages).toHaveLength(1)
      expect(tab.messages[0].role).toBe('system')
      expect(tab.messages[0].content).toBe('Error: Something went wrong')
    })

    it('clears permissionDenied on error', () => {
      const tabId = seedTab({
        status: 'running',
        permissionDenied: { tools: [{ toolName: 'Bash', toolUseId: 'tu-1' }] },
      })
      dispatchEvent(tabId, { type: 'error', message: 'fail', isError: true })

      const tab = getTab(tabId)!
      expect(tab.permissionDenied).toBeNull()
    })
  })

  // ─── session_dead ───

  describe('session_dead', () => {
    it('sets status to dead and adds a system message', () => {
      const tabId = seedTab({ status: 'running', activeRequestId: 'req-1' })
      dispatchEvent(tabId, {
        type: 'session_dead',
        exitCode: 1,
        signal: null,
        stderrTail: ['some error output'],
      })

      const tab = getTab(tabId)!
      expect(tab.status).toBe('dead')
      expect(tab.activeRequestId).toBeNull()
      expect(tab.currentActivity).toBe('')
      expect(tab.permissionQueue).toEqual([])
      const systemMsg = tab.messages.find((m) => m.role === 'system')
      expect(systemMsg?.content).toContain('Session ended unexpectedly (exit 1)')
    })

    it('shows a toast notification for process crash', () => {
      mockAddToast.mockClear()

      const tabId = seedTab({ status: 'running' })
      dispatchEvent(tabId, {
        type: 'session_dead',
        exitCode: 137,
        signal: 'SIGKILL',
        stderrTail: [],
      })

      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          title: 'Process crashed',
        }),
      )
    })

    it('preserves retryState info with updated lastError when tab was retrying', () => {
      const tabId = seedTab({
        status: 'running',
        retryState: {
          isRetrying: true,
          attempt: 2,
          maxAttempts: 3,
          nextRetryAt: null,
        },
      })

      dispatchEvent(tabId, {
        type: 'session_dead',
        exitCode: 1,
        signal: null,
        stderrTail: [],
      })

      const tab = getTab(tabId)!
      expect(tab.retryState).toBeTruthy()
      expect(tab.retryState!.isRetrying).toBe(false)
      expect(tab.retryState!.nextRetryAt).toBeNull()
      expect(tab.retryState!.lastError).toContain('exit 1')
    })

    it('leaves retryState null when tab had no retryState', () => {
      const tabId = seedTab({ status: 'running', retryState: null })
      dispatchEvent(tabId, {
        type: 'session_dead',
        exitCode: 0,
        signal: null,
        stderrTail: [],
      })

      const tab = getTab(tabId)!
      expect(tab.retryState).toBeNull()
    })

    it('handles null exit code', () => {
      const tabId = seedTab({ status: 'running' })
      dispatchEvent(tabId, {
        type: 'session_dead',
        exitCode: null,
        signal: 'SIGTERM',
        stderrTail: [],
      })

      const tab = getTab(tabId)!
      expect(tab.status).toBe('dead')
      const msg = tab.messages.find((m) => m.role === 'system')
      expect(msg?.content).toContain('exit null')
    })
  })

  // ─── permission_request ───

  describe('permission_request', () => {
    it('adds permission request to the queue', () => {
      const tabId = seedTab()
      dispatchEvent(tabId, {
        type: 'permission_request',
        questionId: 'perm-1',
        toolName: 'Bash',
        toolDescription: 'Run a command',
        toolInput: { command: 'rm -rf /' },
        options: [
          { id: 'allow', label: 'Allow', kind: 'allow' },
          { id: 'deny', label: 'Deny', kind: 'deny' },
        ],
      })

      const tab = getTab(tabId)!
      expect(tab.permissionQueue).toHaveLength(1)
      expect(tab.permissionQueue[0]).toEqual({
        questionId: 'perm-1',
        toolTitle: 'Bash',
        toolDescription: 'Run a command',
        toolInput: { command: 'rm -rf /' },
        options: [
          { optionId: 'allow', kind: 'allow', label: 'Allow' },
          { optionId: 'deny', kind: 'deny', label: 'Deny' },
        ],
      })
    })

    it('sets activity to Waiting for permission: {toolName}', () => {
      const tabId = seedTab()
      dispatchEvent(tabId, {
        type: 'permission_request',
        questionId: 'perm-2',
        toolName: 'Write',
        options: [{ id: 'ok', label: 'OK' }],
      })

      const tab = getTab(tabId)!
      expect(tab.currentActivity).toBe('Waiting for permission: Write')
    })

    it('accumulates multiple permission requests', () => {
      const tabId = seedTab()
      dispatchEvent(tabId, {
        type: 'permission_request',
        questionId: 'perm-a',
        toolName: 'Bash',
        options: [{ id: 'allow', label: 'Allow' }],
      })
      dispatchEvent(tabId, {
        type: 'permission_request',
        questionId: 'perm-b',
        toolName: 'Write',
        options: [{ id: 'allow', label: 'Allow' }],
      })

      const tab = getTab(tabId)!
      expect(tab.permissionQueue).toHaveLength(2)
      expect(tab.permissionQueue[0].questionId).toBe('perm-a')
      expect(tab.permissionQueue[1].questionId).toBe('perm-b')
    })
  })

  // ─── rate_limit ───

  describe('rate_limit', () => {
    it('adds a system message when status is not allowed', () => {
      const tabId = seedTab()
      const resetsAt = Date.now() + 60000
      dispatchEvent(tabId, {
        type: 'rate_limit',
        status: 'rate_limited',
        resetsAt,
        rateLimitType: 'output_tokens',
      })

      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(1)
      expect(tab.messages[0].role).toBe('system')
      expect(tab.messages[0].content).toContain('Rate limited')
      expect(tab.messages[0].content).toContain('output_tokens')
    })

    it('does not add a message when status is allowed', () => {
      const tabId = seedTab()
      dispatchEvent(tabId, {
        type: 'rate_limit',
        status: 'allowed',
        resetsAt: Date.now() + 60000,
        rateLimitType: 'input_tokens',
      })

      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(0)
    })
  })

  // ─── Edge cases ───

  describe('edge cases', () => {
    it('does not modify other tabs when handling an event', () => {
      const tab1 = makeTab({ id: 'tab-1' })
      const tab2 = makeTab({ id: 'tab-2', messages: [{ id: 'existing', role: 'user', content: 'hello', timestamp: Date.now() }] })
      useSessionStore.setState({ tabs: [tab1, tab2], tabOrder: ['tab-1', 'tab-2'], activeTabId: 'tab-1' })

      dispatchEvent('tab-1', { type: 'text_chunk', text: 'Hi' })

      const updatedTab2 = getTab('tab-2')!
      expect(updatedTab2.messages).toHaveLength(1)
      expect(updatedTab2.messages[0].content).toBe('hello')
    })

    it('silently ignores events for non-existent tab IDs', () => {
      const tabId = seedTab()
      // Should not throw
      dispatchEvent('nonexistent-tab', { type: 'text_chunk', text: 'ghost' })

      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(0)
    })

    it('handles rapid sequential events correctly', () => {
      const tabId = seedTab({ status: 'connecting' })

      // Simulate a real session lifecycle
      dispatchEvent(tabId, {
        type: 'session_init',
        sessionId: 'ses-rapid',
        model: 'claude-opus-4-6',
        tools: ['Read'],
        mcpServers: [],
        skills: [],
        version: '2.1.0',
      })
      dispatchEvent(tabId, { type: 'text_chunk', text: 'Let me ' })
      dispatchEvent(tabId, { type: 'text_chunk', text: 'read the file.' })
      dispatchEvent(tabId, { type: 'tool_call', toolName: 'Read', toolId: 'tc-1', index: 0 })
      dispatchEvent(tabId, { type: 'tool_call_update', toolId: 'tc-1', partialInput: '{"path":"/foo"}' })
      dispatchEvent(tabId, { type: 'tool_call_complete', index: 0 })
      dispatchEvent(tabId, { type: 'text_chunk', text: 'The file contains...' })
      dispatchEvent(tabId, {
        type: 'task_complete',
        result: 'Done',
        costUsd: 0.01,
        durationMs: 5000,
        numTurns: 2,
        usage: { input_tokens: 500, output_tokens: 200 },
        sessionId: 'ses-rapid',
      })

      const tab = getTab(tabId)!
      expect(tab.status).toBe('completed')
      expect(tab.claudeSessionId).toBe('ses-rapid')
      // Messages: assistant(text) + tool + assistant(text)
      expect(tab.messages).toHaveLength(3)
      expect(tab.messages[0].role).toBe('assistant')
      expect(tab.messages[0].content).toBe('Let me read the file.')
      expect(tab.messages[1].role).toBe('tool')
      expect(tab.messages[1].toolStatus).toBe('completed')
      expect(tab.messages[2].role).toBe('assistant')
      expect(tab.messages[2].content).toBe('The file contains...')
    })
  })

  // ─── handleStatusChange ───

  describe('handleStatusChange', () => {
    it('updates tab status', () => {
      const tabId = seedTab({ status: 'running' })
      useSessionStore.getState().handleStatusChange(tabId, 'completed', 'running')

      const tab = getTab(tabId)!
      expect(tab.status).toBe('completed')
    })

    it('clears activity and permission state when transitioning to idle', () => {
      const tabId = seedTab({
        status: 'connecting',
        currentActivity: 'Starting...',
        permissionQueue: [{ questionId: 'q1', toolTitle: 'Bash', options: [] }],
        permissionDenied: { tools: [{ toolName: 'Bash', toolUseId: 'tu-1' }] },
      })

      useSessionStore.getState().handleStatusChange(tabId, 'idle', 'connecting')

      const tab = getTab(tabId)!
      expect(tab.status).toBe('idle')
      expect(tab.currentActivity).toBe('')
      expect(tab.permissionQueue).toEqual([])
      expect(tab.permissionDenied).toBeNull()
    })

    it('clears retryState when transitioning to completed', () => {
      const tabId = seedTab({
        status: 'running',
        retryState: { isRetrying: true, attempt: 1, maxAttempts: 3, nextRetryAt: null },
      })

      useSessionStore.getState().handleStatusChange(tabId, 'completed', 'running')

      const tab = getTab(tabId)!
      expect(tab.retryState).toBeNull()
    })

    it('clears retryState when transitioning to failed', () => {
      const tabId = seedTab({
        status: 'running',
        retryState: { isRetrying: true, attempt: 2, maxAttempts: 3, nextRetryAt: null },
      })

      useSessionStore.getState().handleStatusChange(tabId, 'failed', 'running')

      const tab = getTab(tabId)!
      expect(tab.retryState).toBeNull()
    })

    it('does not clear retryState when transitioning to running', () => {
      const tabId = seedTab({
        status: 'connecting',
        retryState: { isRetrying: true, attempt: 1, maxAttempts: 3, nextRetryAt: null },
      })

      useSessionStore.getState().handleStatusChange(tabId, 'running', 'connecting')

      const tab = getTab(tabId)!
      expect(tab.retryState).toBeTruthy()
    })
  })

  // ─── handleError ───

  describe('handleError', () => {
    it('sets status to failed and adds an error message', () => {
      const tabId = seedTab({ status: 'running', activeRequestId: 'req-1' })
      useSessionStore.getState().handleError(tabId, {
        message: 'Process crashed',
        stderrTail: [],
        exitCode: 1,
        elapsedMs: 5000,
        toolCallCount: 3,
      })

      const tab = getTab(tabId)!
      expect(tab.status).toBe('failed')
      expect(tab.activeRequestId).toBeNull()
      expect(tab.currentActivity).toBe('')
      expect(tab.messages).toHaveLength(1)
      expect(tab.messages[0].role).toBe('system')
      expect(tab.messages[0].content).toContain('Error: Process crashed')
    })

    it('includes stderr tail in the error message', () => {
      const tabId = seedTab({ status: 'running' })
      useSessionStore.getState().handleError(tabId, {
        message: 'CLI error',
        stderrTail: ['line 1', 'line 2', 'line 3'],
        exitCode: 1,
        elapsedMs: 0,
        toolCallCount: 0,
      })

      const tab = getTab(tabId)!
      expect(tab.messages[0].content).toContain('line 1')
      expect(tab.messages[0].content).toContain('line 3')
    })

    it('deduplicates errors when last message is already a system error', () => {
      const tabId = seedTab({
        status: 'running',
        messages: [
          { id: 'msg-err', role: 'system', content: 'Error: First failure', timestamp: Date.now() },
        ],
      })

      useSessionStore.getState().handleError(tabId, {
        message: 'Second failure',
        stderrTail: [],
        exitCode: 1,
        elapsedMs: 0,
        toolCallCount: 0,
      })

      const tab = getTab(tabId)!
      // Should NOT add another error — deduplicated
      expect(tab.messages).toHaveLength(1)
      expect(tab.messages[0].content).toBe('Error: First failure')
    })

    it('does not deduplicate when last message is not a system error', () => {
      const tabId = seedTab({
        status: 'running',
        messages: [
          { id: 'msg-ok', role: 'assistant', content: 'Some text', timestamp: Date.now() },
        ],
      })

      useSessionStore.getState().handleError(tabId, {
        message: 'Process failed',
        stderrTail: [],
        exitCode: 1,
        elapsedMs: 0,
        toolCallCount: 0,
      })

      const tab = getTab(tabId)!
      expect(tab.messages).toHaveLength(2)
      expect(tab.messages[1].content).toContain('Error: Process failed')
    })

    it('shows a toast notification', () => {
      mockAddToast.mockClear()

      const tabId = seedTab({ status: 'running' })
      useSessionStore.getState().handleError(tabId, {
        message: 'Something broke',
        stderrTail: [],
        exitCode: 1,
        elapsedMs: 0,
        toolCallCount: 0,
      })

      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          title: 'Error',
          message: 'Something broke',
        }),
      )
    })

    it('preserves retryState on error', () => {
      const tabId = seedTab({
        status: 'running',
        retryState: { isRetrying: true, attempt: 2, maxAttempts: 3, nextRetryAt: null },
      })

      useSessionStore.getState().handleError(tabId, {
        message: 'fail',
        stderrTail: [],
        exitCode: 1,
        elapsedMs: 0,
        toolCallCount: 0,
      })

      const tab = getTab(tabId)!
      expect(tab.retryState).toBeTruthy()
      expect(tab.retryState!.attempt).toBe(2)
    })
  })

  // ─── BUG-003: tool_call_update / tool_call_complete must not mutate in-place ───

  describe('BUG-003: immutable tool call message updates', () => {
    it('tool_call_update creates a new message object instead of mutating', () => {
      const originalMsg: Message = {
        id: 'msg-orig',
        role: 'tool',
        content: '',
        toolName: 'Bash',
        toolInput: '',
        toolStatus: 'running',
        timestamp: Date.now(),
      }
      const tabId = seedTab({ messages: [originalMsg] })

      // Capture reference to the original message object
      const beforeMessages = getTab(tabId)!.messages
      const beforeMsg = beforeMessages[0]

      dispatchEvent(tabId, { type: 'tool_call_update', toolId: 'tool-1', partialInput: '{"cmd":"ls"}' })

      const afterTab = getTab(tabId)!
      const afterMsg = afterTab.messages[0]

      // The updated message should have the new toolInput
      expect(afterMsg.toolInput).toBe('{"cmd":"ls"}')
      // But the original message object must NOT have been mutated
      expect(beforeMsg.toolInput).toBe('')
      // The message object should be a new reference
      expect(afterMsg).not.toBe(beforeMsg)
    })

    it('tool_call_complete creates a new message object instead of mutating', () => {
      const originalMsg: Message = {
        id: 'msg-orig',
        role: 'tool',
        content: '',
        toolName: 'Read',
        toolInput: '{"path":"/foo"}',
        toolStatus: 'running',
        timestamp: Date.now(),
      }
      const tabId = seedTab({ messages: [originalMsg] })

      const beforeMsg = getTab(tabId)!.messages[0]

      dispatchEvent(tabId, { type: 'tool_call_complete', index: 0 })

      const afterMsg = getTab(tabId)!.messages[0]

      // The updated message should have completed status
      expect(afterMsg.toolStatus).toBe('completed')
      // But the original message object must NOT have been mutated
      expect(beforeMsg.toolStatus).toBe('running')
      // The message object should be a new reference
      expect(afterMsg).not.toBe(beforeMsg)
    })
  })

  // ─── BUG-006: IPC rejection must clear activeRequestId ───

  describe('BUG-006: handleError clears activeRequestId on IPC rejection', () => {
    it('clears activeRequestId and sets failed status on error', () => {
      const tabId = seedTab({
        status: 'connecting',
        activeRequestId: 'req-123',
      })

      useSessionStore.getState().handleError(tabId, {
        message: 'IPC call rejected',
        stderrTail: [],
        exitCode: null,
        elapsedMs: 0,
        toolCallCount: 0,
      })

      const tab = getTab(tabId)!
      expect(tab.activeRequestId).toBeNull()
      expect(tab.status).toBe('failed')
    })

    it('restores status from connecting to failed on sendMessage IPC rejection', () => {
      const tabId = seedTab({
        status: 'connecting',
        activeRequestId: 'req-456',
      })

      // handleError is what the .catch() handlers call
      useSessionStore.getState().handleError(tabId, {
        message: 'Connection refused',
        stderrTail: [],
        exitCode: null,
        elapsedMs: 0,
        toolCallCount: 0,
      })

      const tab = getTab(tabId)!
      expect(tab.status).toBe('failed')
      expect(tab.activeRequestId).toBeNull()
      expect(tab.currentActivity).toBe('')
    })
  })
})
