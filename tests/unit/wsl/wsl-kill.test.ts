import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// Mock child_process before importing RunManager
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}))

// Mock the platform module
vi.mock('../../../src/main/platform', () => ({
  resolveClaudeEntryPoint: () => ({ binary: 'claude', prefixArgs: [] }),
  getLoginShellPath: () => '',
  ensureBinDirInPath: () => {},
}))

// Mock the wsl-spawner module
vi.mock('../../../src/main/wsl/wsl-spawner', () => ({
  spawnInWsl: vi.fn(),
}))

import { RunManager } from '../../../src/main/claude/run-manager'
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'

const mockSpawn = vi.mocked(spawn)

/**
 * Create a minimal mock ChildProcess for testing cancel behavior.
 */
function createMockProcess(opts?: { stdinDestroyed?: boolean }): ChildProcess {
  const proc = new EventEmitter() as ChildProcess

  const stdin = new EventEmitter() as NodeJS.WritableStream & { destroyed: boolean; end: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }
  stdin.destroyed = opts?.stdinDestroyed ?? false
  stdin.end = vi.fn()
  stdin.write = vi.fn()

  const stdout = new EventEmitter() as NodeJS.ReadableStream & { setEncoding: ReturnType<typeof vi.fn> }
  stdout.setEncoding = vi.fn()

  const stderr = new EventEmitter() as NodeJS.ReadableStream & { setEncoding: ReturnType<typeof vi.fn> }
  stderr.setEncoding = vi.fn()

  Object.defineProperty(proc, 'stdin', { value: stdin, writable: true })
  Object.defineProperty(proc, 'stdout', { value: stdout, writable: true })
  Object.defineProperty(proc, 'stderr', { value: stderr, writable: true })
  Object.defineProperty(proc, 'pid', { value: 12345, writable: true })
  Object.defineProperty(proc, 'exitCode', { value: null, writable: true })
  Object.defineProperty(proc, 'killed', { value: false, writable: true })

  proc.kill = vi.fn()

  return proc
}

describe('RunManager cancel — stdin close + SIGINT', () => {
  let rm: RunManager
  let mockProcess: ChildProcess

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    rm = new RunManager()
    mockProcess = createMockProcess()
    mockSpawn.mockReturnValue(mockProcess)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function startTestRun(requestId = 'test-run'): void {
    rm.startRun(requestId, {
      prompt: 'hello',
      projectPath: '/tmp',
    })
  }

  it('closes stdin before sending SIGINT', () => {
    startTestRun()

    const result = rm.cancel('test-run')

    expect(result).toBe(true)
    // stdin.end() should be called
    expect(mockProcess.stdin!.end).toHaveBeenCalled()
    // SIGINT should be sent
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGINT')

    // Verify order: stdin.end was called before kill
    const endOrder = (mockProcess.stdin!.end as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    const killOrder = (mockProcess.kill as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    expect(endOrder).toBeLessThan(killOrder)
  })

  it('handles already-destroyed stdin gracefully', () => {
    // Override with a process that has destroyed stdin
    const procWithDestroyedStdin = createMockProcess({ stdinDestroyed: true })
    mockSpawn.mockReturnValue(procWithDestroyedStdin)

    rm = new RunManager()
    rm.startRun('test-run', { prompt: 'hello', projectPath: '/tmp' })

    const result = rm.cancel('test-run')

    expect(result).toBe(true)
    // stdin.end should NOT be called since stdin is already destroyed
    expect(procWithDestroyedStdin.stdin!.end).not.toHaveBeenCalled()
    // SIGINT should still be sent
    expect(procWithDestroyedStdin.kill).toHaveBeenCalledWith('SIGINT')
  })

  it('force-kills after timeout if process still alive', () => {
    startTestRun()

    rm.cancel('test-run')

    // Initially only SIGINT
    expect(mockProcess.kill).toHaveBeenCalledTimes(1)
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGINT')

    // Advance past the 5s timeout — process hasn't exited (exitCode is null)
    vi.advanceTimersByTime(5000)

    // Should now also have sent SIGKILL
    expect(mockProcess.kill).toHaveBeenCalledTimes(2)
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('does not force-kill if process exited before timeout', () => {
    startTestRun()

    rm.cancel('test-run')

    // Simulate process exiting before the timeout
    Object.defineProperty(mockProcess, 'exitCode', { value: 0, writable: true })

    // Advance past the 5s timeout
    vi.advanceTimersByTime(5000)

    // Only SIGINT should have been sent, no SIGKILL
    expect(mockProcess.kill).toHaveBeenCalledTimes(1)
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGINT')
  })

  it('returns false for unknown requestId', () => {
    const result = rm.cancel('nonexistent')
    expect(result).toBe(false)
  })
})
