import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ShellExecRequest, ShellOutput } from '../../src/shared/types'

// Mock child_process before importing the module under test
const mockSpawn = vi.fn()
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

// Mock permission-server for maskSensitiveFields
vi.mock('../../src/main/hooks/permission-server', () => ({
  maskSensitiveFields: vi.fn((x: unknown) => x),
}))

import { executeShell, getShellForPlatform } from '../../src/main/shell-executor'

function createMockProcess(opts: {
  stdout?: string
  stderr?: string
  exitCode?: number
  delay?: number
  error?: Error
} = {}) {
  const { stdout = '', stderr = '', exitCode = 0, delay = 0, error } = opts
  const stdoutListeners: Record<string, Function[]> = {}
  const stderrListeners: Record<string, Function[]> = {}
  const procListeners: Record<string, Function[]> = {}

  const proc = {
    stdout: {
      setEncoding: vi.fn(),
      on: vi.fn((event: string, cb: Function) => {
        if (!stdoutListeners[event]) stdoutListeners[event] = []
        stdoutListeners[event].push(cb)
      }),
    },
    stderr: {
      setEncoding: vi.fn(),
      on: vi.fn((event: string, cb: Function) => {
        if (!stderrListeners[event]) stderrListeners[event] = []
        stderrListeners[event].push(cb)
      }),
    },
    on: vi.fn((event: string, cb: Function) => {
      if (!procListeners[event]) procListeners[event] = []
      procListeners[event].push(cb)
    }),
    kill: vi.fn(),
    pid: 12345,
  }

  // Emit events after a tick
  setTimeout(() => {
    if (error) {
      procListeners['error']?.forEach(cb => cb(error))
      return
    }
    if (stdout) {
      stdoutListeners['data']?.forEach(cb => cb(stdout))
    }
    if (stderr) {
      stderrListeners['data']?.forEach(cb => cb(stderr))
    }
    setTimeout(() => {
      procListeners['close']?.forEach(cb => cb(exitCode, null))
    }, delay)
  }, 0)

  return proc
}

describe('getShellForPlatform', () => {
  it('returns cmd.exe and /c on win32', () => {
    const result = getShellForPlatform('win32')
    expect(result.shell).toBe('cmd.exe')
    expect(result.flag).toBe('/c')
  })

  it('returns /bin/sh and -c on linux', () => {
    const result = getShellForPlatform('linux')
    expect(result.shell).toBe('/bin/sh')
    expect(result.flag).toBe('-c')
  })

  it('returns /bin/sh and -c on darwin', () => {
    const result = getShellForPlatform('darwin')
    expect(result.shell).toBe('/bin/sh')
    expect(result.flag).toBe('-c')
  })
})

describe('executeShell', () => {
  beforeEach(() => {
    mockSpawn.mockReset()
  })

  it('rejects empty command', async () => {
    const result = await executeShell({ tabId: 't1', command: '', cwd: '/tmp' })
    expect(result.exitCode).toBe(-1)
    expect(result.stderr).toMatch(/empty/i)
  })

  it('rejects whitespace-only command', async () => {
    const result = await executeShell({ tabId: 't1', command: '   ', cwd: '/tmp' })
    expect(result.exitCode).toBe(-1)
    expect(result.stderr).toMatch(/empty/i)
  })

  it('captures stdout', async () => {
    mockSpawn.mockReturnValue(createMockProcess({ stdout: 'hello world\n' }))
    const result = await executeShell({ tabId: 't1', command: 'echo hello', cwd: '/tmp' })
    expect(result.stdout).toBe('hello world\n')
    expect(result.exitCode).toBe(0)
  })

  it('captures stderr', async () => {
    mockSpawn.mockReturnValue(createMockProcess({ stderr: 'error msg\n', exitCode: 1 }))
    const result = await executeShell({ tabId: 't1', command: 'bad cmd', cwd: '/tmp' })
    expect(result.stderr).toBe('error msg\n')
    expect(result.exitCode).toBe(1)
  })

  it('caps output at 50KB', async () => {
    const bigOutput = 'x'.repeat(60_000)
    mockSpawn.mockReturnValue(createMockProcess({ stdout: bigOutput }))
    const result = await executeShell({ tabId: 't1', command: 'big', cwd: '/tmp' })
    expect(result.stdout.length).toBeLessThanOrEqual(50 * 1024 + 100) // buffer for truncation message
    expect(result.truncated).toBe(true)
  })

  it('enforces 30s timeout', async () => {
    vi.useFakeTimers()
    const proc = createMockProcess({ delay: 999999 })
    // Override: do NOT emit close
    proc.on = vi.fn((event: string, cb: Function) => {
      // Only register close but never call it
    })
    proc.stdout.on = vi.fn()
    proc.stderr.on = vi.fn()
    mockSpawn.mockReturnValue(proc)

    const promise = executeShell({ tabId: 't1', command: 'sleep 60', cwd: '/tmp' })
    vi.advanceTimersByTime(31_000)

    const result = await promise
    expect(result.exitCode).toBe(-1)
    expect(result.stderr).toMatch(/timed out/i)
    expect(proc.kill).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('handles spawn error', async () => {
    mockSpawn.mockReturnValue(createMockProcess({ error: new Error('ENOENT') }))
    const result = await executeShell({ tabId: 't1', command: 'nonexistent', cwd: '/tmp' })
    expect(result.exitCode).toBe(-1)
    expect(result.stderr).toMatch(/ENOENT/)
  })

  it('passes cwd to spawn', async () => {
    mockSpawn.mockReturnValue(createMockProcess({ stdout: '' }))
    await executeShell({ tabId: 't1', command: 'pwd', cwd: '/home/user' })
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['pwd']),
      expect.objectContaining({ cwd: '/home/user' })
    )
  })
})
