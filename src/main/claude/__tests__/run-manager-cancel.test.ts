import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock child_process spawn before importing RunManager
const mockSpawn = vi.fn()
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

// Mock dependencies
vi.mock('../../logger', () => ({
  log: vi.fn(),
}))

vi.mock('../../platform', () => ({
  resolveClaudeEntryPoint: () => ({ binary: '/usr/bin/claude', prefixArgs: [] }),
  getLoginShellPath: () => '',
  ensureBinDirInPath: vi.fn(),
}))

vi.mock('../../wsl/wsl-spawner', () => ({
  spawnInWsl: vi.fn(),
}))

vi.mock('../prompt-file', () => ({
  buildPromptArgs: (_id: string, _content: string, _isWsl: boolean) => ({
    args: ['--append-system-prompt', 'test'],
    filePath: null,
  }),
  cleanupPromptFile: vi.fn(),
}))

vi.mock('../../stream-parser', () => ({
  StreamParser: {
    fromStream: () => ({
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    }),
  },
}))

import { RunManager } from '../run-manager'

describe('BUG-004: RunManager.cancel() race condition', () => {
  let runManager: RunManager
  let mockProcess: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    mockProcess = {
      pid: 12345,
      stdin: { write: vi.fn(), end: vi.fn(), destroyed: false },
      stdout: { on: vi.fn(), setEncoding: vi.fn() },
      stderr: { on: vi.fn(), setEncoding: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      removeAllListeners: vi.fn(),
      exitCode: null,
    }
    mockSpawn.mockReturnValue(mockProcess)
    runManager = new RunManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not call SIGKILL if process has already exited before timeout', () => {
    runManager.startRun('req-cancel-1', {
      prompt: 'test',
      projectPath: '~',
    })

    runManager.cancel('req-cancel-1')

    // Process exits before the 5s timeout
    mockProcess.exitCode = 0

    // Advance past the 5s fallback timer
    vi.advanceTimersByTime(6000)

    // kill should have been called once for SIGINT, but NOT for SIGKILL
    const killCalls = (mockProcess.kill as ReturnType<typeof vi.fn>).mock.calls
    expect(killCalls).toHaveLength(1)
    expect(killCalls[0][0]).toBe('SIGINT')
  })

  it('calls SIGKILL if process has NOT exited after 5s timeout', () => {
    runManager.startRun('req-cancel-2', {
      prompt: 'test',
      projectPath: '~',
    })

    runManager.cancel('req-cancel-2')

    // Process has NOT exited — exitCode stays null
    vi.advanceTimersByTime(6000)

    const killCalls = (mockProcess.kill as ReturnType<typeof vi.fn>).mock.calls
    expect(killCalls).toHaveLength(2)
    expect(killCalls[0][0]).toBe('SIGINT')
    expect(killCalls[1][0]).toBe('SIGKILL')
  })

  it('does not throw if process reference becomes unavailable in timeout callback', () => {
    runManager.startRun('req-cancel-3', {
      prompt: 'test',
      projectPath: '~',
    })

    runManager.cancel('req-cancel-3')

    // Simulate process being cleaned up — set exitCode to a number (exited)
    mockProcess.exitCode = 137

    // Should not throw when the timeout fires
    expect(() => vi.advanceTimersByTime(6000)).not.toThrow()
  })
})
