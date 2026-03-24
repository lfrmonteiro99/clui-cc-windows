import { describe, it, expect, vi, beforeEach } from 'vitest'

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

describe('RunManager fork-session args', () => {
  let runManager: RunManager

  beforeEach(() => {
    vi.clearAllMocks()

    // Create a mock child process
    const mockProcess = {
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

  it('includes --fork-session and --resume when forkSession is true', () => {
    runManager.startRun('req-1', {
      prompt: 'Continue',
      projectPath: '/tmp',
      forkSession: true,
      forkFromSessionId: 'parent-session-abc',
    })

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
    expect(spawnArgs).toContain('--fork-session')
    expect(spawnArgs).toContain('--resume')

    // --resume should be followed by the parent session ID
    const resumeIdx = spawnArgs.indexOf('--resume')
    expect(spawnArgs[resumeIdx + 1]).toBe('parent-session-abc')
  })

  it('does NOT include --fork-session when forkSession is false/undefined', () => {
    runManager.startRun('req-2', {
      prompt: 'Hello',
      projectPath: '/tmp',
      sessionId: 'existing-session',
    })

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
    expect(spawnArgs).not.toContain('--fork-session')
    expect(spawnArgs).toContain('--resume')
    const resumeIdx = spawnArgs.indexOf('--resume')
    expect(spawnArgs[resumeIdx + 1]).toBe('existing-session')
  })

  it('--fork-session overrides normal --resume behavior', () => {
    // When forkSession is true, the sessionId field should NOT be used for --resume
    runManager.startRun('req-3', {
      prompt: 'Continue',
      projectPath: '/tmp',
      sessionId: 'should-be-ignored',
      forkSession: true,
      forkFromSessionId: 'parent-session-xyz',
    })

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
    expect(spawnArgs).toContain('--fork-session')

    // Should use forkFromSessionId, not sessionId
    const resumeIdx = spawnArgs.indexOf('--resume')
    expect(spawnArgs[resumeIdx + 1]).toBe('parent-session-xyz')

    // sessionId should not appear as a second --resume
    const allResumeIndices = spawnArgs.reduce<number[]>((acc, arg, i) => {
      if (arg === '--resume') acc.push(i)
      return acc
    }, [])
    expect(allResumeIndices).toHaveLength(1)
  })

  it('does not include --fork-session when forkFromSessionId is missing', () => {
    runManager.startRun('req-4', {
      prompt: 'Hello',
      projectPath: '/tmp',
      forkSession: true,
      // forkFromSessionId intentionally missing
    })

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
    expect(spawnArgs).not.toContain('--fork-session')
    expect(spawnArgs).not.toContain('--resume')
  })
})
