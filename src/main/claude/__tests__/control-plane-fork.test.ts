import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// Mock RunManager
vi.mock('../run-manager', () => {
  return {
    RunManager: vi.fn().mockImplementation(() => {
      const emitter = new EventEmitter()
      return Object.assign(emitter, {
        startRun: vi.fn().mockReturnValue({
          runId: 'mock-run',
          sessionId: null,
          process: { pid: 123, stdin: { write: vi.fn() }, stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn() },
          pid: 123,
          startedAt: Date.now(),
          stderrTail: { push: vi.fn(), toArray: () => [] },
          stdoutTail: { push: vi.fn(), toArray: () => [] },
          toolCallCount: 0,
          sawPermissionRequest: false,
          permissionDenials: [],
          promptFilePath: null,
        }),
        cancel: vi.fn().mockReturnValue(true),
        isRunning: vi.fn().mockReturnValue(false),
        getHandle: vi.fn(),
        getActiveRunIds: vi.fn().mockReturnValue([]),
        getEnrichedError: vi.fn().mockReturnValue({
          message: 'mock error',
          stderrTail: [],
          exitCode: null,
          elapsedMs: 0,
          toolCallCount: 0,
        }),
      })
    }),
  }
})

// Mock PtyRunManager
vi.mock('../pty-run-manager', () => {
  return {
    PtyRunManager: vi.fn().mockImplementation(() => {
      const emitter = new EventEmitter()
      return Object.assign(emitter, {
        startRun: vi.fn(),
        cancel: vi.fn(),
        isRunning: vi.fn().mockReturnValue(false),
        getEnrichedError: vi.fn(),
      })
    }),
  }
})

// Mock PermissionServer
vi.mock('../../hooks/permission-server', () => {
  return {
    PermissionServer: vi.fn().mockImplementation(() => ({
      start: vi.fn().mockResolvedValue(0),
      getPort: vi.fn().mockReturnValue(null),
      registerRun: vi.fn().mockReturnValue('mock-token'),
      unregisterRun: vi.fn(),
      generateSettingsFile: vi.fn().mockReturnValue('/tmp/settings.json'),
      respondToPermission: vi.fn(),
      on: vi.fn(),
    })),
    maskSensitiveFields: vi.fn((x: unknown) => x),
  }
})

// Mock AgentMemory
vi.mock('../../agent-memory', () => ({
  AgentMemory: vi.fn(),
}))

// Mock sandbox modules
vi.mock('../../sandbox/worktree-manager', () => ({
  WorktreeManager: vi.fn().mockImplementation(() => ({
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    getWorktree: vi.fn(),
  })),
}))

vi.mock('../../sandbox/git-diff-engine', () => ({
  GitDiffEngine: vi.fn().mockImplementation(() => ({
    getDiff: vi.fn(),
  })),
}))

vi.mock('../../sandbox/dirty-detector', () => ({
  DirtyDetector: vi.fn().mockImplementation(() => ({
    check: vi.fn(),
    autoStash: vi.fn(),
  })),
}))

vi.mock('../../logger', () => ({
  log: vi.fn(),
}))

vi.mock('../../budget-enforcer', () => ({
  BudgetEnforcer: vi.fn(),
}))

vi.mock('../prompt-file', () => ({
  buildPromptArgs: () => ({ args: [], filePath: null }),
  cleanupPromptFile: vi.fn(),
}))

import { ControlPlane } from '../control-plane'
import { RunManager } from '../run-manager'

describe('ControlPlane.forkSession()', () => {
  let cp: ControlPlane
  let mockRunManager: ReturnType<typeof RunManager.prototype.startRun> & EventEmitter

  beforeEach(() => {
    vi.clearAllMocks()
    cp = new ControlPlane(false)
    // Get reference to the internal RunManager mock instance
    // @ts-expect-error accessing private for test
    mockRunManager = cp.runManager
  })

  it('throws when source tab does not exist', async () => {
    await expect(cp.forkSession('nonexistent-tab', '/tmp')).rejects.toThrow('Source tab not found')
  })

  it('throws when source tab has no session ID', async () => {
    const tabId = cp.createTab()
    // Tab has no claudeSessionId by default
    await expect(cp.forkSession(tabId, '/tmp')).rejects.toThrow('No session to fork')
  })

  it('throws when source tab is actively running', async () => {
    const tabId = cp.createTab()
    // Simulate a tab with an active session and running request
    // @ts-expect-error accessing private for test
    const tab = cp.tabs.get(tabId)!
    tab.claudeSessionId = 'session-123'
    tab.activeRequestId = 'req-active'

    await expect(cp.forkSession(tabId, '/tmp')).rejects.toThrow('Cannot fork while session is running')
  })

  it('creates a new tab and calls submitPrompt with fork options', async () => {
    const tabId = cp.createTab()
    // Simulate an idle tab with an existing session
    // @ts-expect-error accessing private for test
    const tab = cp.tabs.get(tabId)!
    tab.claudeSessionId = 'session-parent-abc'
    tab.status = 'completed'

    // submitPrompt will call runManager.startRun internally.
    // We need the promise to resolve, so simulate the exit event after a tick.
    const startRunMock = (mockRunManager as unknown as { startRun: ReturnType<typeof vi.fn> }).startRun
    startRunMock.mockImplementation((requestId: string) => {
      // Simulate immediate successful exit
      setTimeout(() => {
        mockRunManager.emit('exit', requestId, 0, null, 'new-forked-session-id')
      }, 10)
      return {
        runId: requestId,
        sessionId: null,
        process: { pid: 456, stdin: { write: vi.fn() } },
        pid: 456,
        startedAt: Date.now(),
        stderrTail: { push: vi.fn(), toArray: () => [] },
        stdoutTail: { push: vi.fn(), toArray: () => [] },
        toolCallCount: 0,
        sawPermissionRequest: false,
        permissionDenials: [],
        promptFilePath: null,
      }
    })

    const result = await cp.forkSession(tabId, '/home/user/project')

    expect(result.newTabId).toBeDefined()
    expect(result.newTabId).not.toBe(tabId)

    // Verify startRun was called with fork options
    expect(startRunMock).toHaveBeenCalledWith(
      expect.stringContaining('fork-'),
      expect.objectContaining({
        forkSession: true,
        forkFromSessionId: 'session-parent-abc',
        projectPath: '/home/user/project',
      }),
    )
  })
})
