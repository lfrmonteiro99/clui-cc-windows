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

describe('RunManager --from-pr args', () => {
  let runManager: RunManager

  beforeEach(() => {
    vi.clearAllMocks()

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

  it('includes --from-pr flag when fromPr is specified in RunOptions', () => {
    runManager.startRun('req-pr-1', {
      prompt: 'Review this PR',
      projectPath: '/tmp/project',
      fromPr: '447',
    })

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    const args = mockSpawn.mock.calls[0][1] as string[]
    const fromPrIdx = args.indexOf('--from-pr')
    expect(fromPrIdx).toBeGreaterThan(-1)
    expect(args[fromPrIdx + 1]).toBe('447')
  })

  it('does not include --from-pr flag when fromPr is not specified', () => {
    runManager.startRun('req-pr-2', {
      prompt: 'hello',
      projectPath: '~',
    })

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    const args = mockSpawn.mock.calls[0][1] as string[]
    expect(args).not.toContain('--from-pr')
  })

  it('combines --from-pr with other flags like --effort', () => {
    runManager.startRun('req-pr-3', {
      prompt: 'Review PR with high effort',
      projectPath: '/tmp/project',
      fromPr: '123',
      effort: 'high',
    })

    const args = mockSpawn.mock.calls[0][1] as string[]
    const fromPrIdx = args.indexOf('--from-pr')
    const effortIdx = args.indexOf('--effort')
    expect(fromPrIdx).toBeGreaterThan(-1)
    expect(args[fromPrIdx + 1]).toBe('123')
    expect(effortIdx).toBeGreaterThan(-1)
    expect(args[effortIdx + 1]).toBe('high')
  })

  it('combines --from-pr with --resume (session ID)', () => {
    runManager.startRun('req-pr-4', {
      prompt: 'Continue PR review',
      projectPath: '/tmp/project',
      fromPr: '789',
      sessionId: 'session-abc',
    })

    const args = mockSpawn.mock.calls[0][1] as string[]
    expect(args).toContain('--from-pr')
    expect(args).toContain('--resume')
    expect(args[args.indexOf('--from-pr') + 1]).toBe('789')
    expect(args[args.indexOf('--resume') + 1]).toBe('session-abc')
  })
})
