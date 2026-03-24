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

describe('RunManager effort args', () => {
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

  it('includes --effort flag when effort is specified in RunOptions', () => {
    runManager.startRun('req-1', {
      prompt: 'hello',
      projectPath: '~',
      effort: 'high',
    })

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    const args = mockSpawn.mock.calls[0][1] as string[]
    const effortIdx = args.indexOf('--effort')
    expect(effortIdx).toBeGreaterThan(-1)
    expect(args[effortIdx + 1]).toBe('high')
  })

  it('does not include --effort flag when effort is not specified', () => {
    runManager.startRun('req-2', {
      prompt: 'hello',
      projectPath: '~',
    })

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    const args = mockSpawn.mock.calls[0][1] as string[]
    expect(args).not.toContain('--effort')
  })

  it.each(['low', 'medium', 'high', 'max'] as const)('passes --effort %s correctly', (level) => {
    runManager.startRun(`req-${level}`, {
      prompt: 'test',
      projectPath: '~',
      effort: level,
    })

    const args = mockSpawn.mock.calls[0][1] as string[]
    const effortIdx = args.indexOf('--effort')
    expect(effortIdx).toBeGreaterThan(-1)
    expect(args[effortIdx + 1]).toBe(level)
  })
})
