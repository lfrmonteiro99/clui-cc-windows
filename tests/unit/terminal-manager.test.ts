/**
 * TERM-013: TerminalManager class tests (Priority 1)
 *
 * Tests the main-process TerminalManager that manages PTY-backed shell sessions.
 * node-pty is mocked to avoid native dependency in test environment.
 *
 * Note: The TerminalManager uses require('node-pty') internally.
 * vi.mock intercepts this, but the mock object received by the constructor
 * differs from the top-level import reference. We use vi.spyOn on the
 * internal ptyModule to capture calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../src/shared/types'

// ─── Mock node-pty at top level ───

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    pid: 1,
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  })),
}))
vi.mock('../../src/main/logger', () => ({ log: vi.fn() }))

// ─── Tests for IPC channel definitions ───

describe('Terminal IPC channels', () => {
  it('TERMINAL_CREATE is defined', () => {
    expect(IPC.TERMINAL_CREATE).toBe('clui:terminal-create')
  })

  it('TERMINAL_WRITE is defined', () => {
    expect(IPC.TERMINAL_WRITE).toBe('clui:terminal-write')
  })

  it('TERMINAL_RESIZE is defined', () => {
    expect(IPC.TERMINAL_RESIZE).toBe('clui:terminal-resize')
  })

  it('TERMINAL_CLOSE is defined', () => {
    expect(IPC.TERMINAL_CLOSE).toBe('clui:terminal-close')
  })

  it('TERMINAL_DATA is defined', () => {
    expect(IPC.TERMINAL_DATA).toBe('clui:terminal-data')
  })

  it('TERMINAL_EXIT is defined', () => {
    expect(IPC.TERMINAL_EXIT).toBe('clui:terminal-exit')
  })

  it('all terminal channels follow clui: prefix convention', () => {
    const termChannels = Object.entries(IPC).filter(([k]) => k.startsWith('TERMINAL_'))
    expect(termChannels.length).toBeGreaterThanOrEqual(6)
    for (const [, v] of termChannels) {
      expect(v).toMatch(/^clui:terminal-/)
    }
  })
})

describe('Terminal types', () => {
  it('TerminalTab interface shape', () => {
    const tab: import('../../src/shared/types').TerminalTab = {
      id: 'test',
      title: 'bash',
      shell: '/bin/bash',
      cwd: '/home/user',
      status: 'active',
      exitCode: null,
    }
    expect(tab.id).toBe('test')
    expect(tab.status).toBe('active')
  })

  it('TerminalCreateOptions interface shape', () => {
    const opts: import('../../src/shared/types').TerminalCreateOptions = {
      shell: 'powershell.exe',
      cwd: 'C:\\Users\\test',
    }
    expect(opts.shell).toBe('powershell.exe')
  })

  it('TerminalCreateOptions fields are optional', () => {
    const opts: import('../../src/shared/types').TerminalCreateOptions = {}
    expect(opts.shell).toBeUndefined()
  })
})

// ─── TerminalManager class tests (Priority 1) ───

describe('TerminalManager', () => {
  let TerminalManager: typeof import('../../src/main/terminal/terminal-manager').TerminalManager
  let broadcastSpy: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.useFakeTimers()
    broadcastSpy = vi.fn()

    const mod = await import('../../src/main/terminal/terminal-manager')
    TerminalManager = mod.TerminalManager
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * Helper: creates a TerminalManager and replaces its internal ptyModule.spawn
   * with a spy that uses the given implementation, returning the spy for assertions.
   */
  function createManagerWithSpy(
    spawnImpl?: (...args: unknown[]) => unknown,
  ): { manager: InstanceType<typeof TerminalManager>; spawnSpy: ReturnType<typeof vi.fn> } {
    const manager = new TerminalManager(broadcastSpy)
    // Replace internal ptyModule.spawn with a controllable spy
    const defaultImpl = () => ({
      pid: 1,
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    })
    const spawnSpy = vi.fn(spawnImpl ?? defaultImpl)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(manager as any).ptyModule = { spawn: spawnSpy }
    return { manager, spawnSpy }
  }

  describe('isAvailable()', () => {
    it('returns true when node-pty is loadable', () => {
      const manager = new TerminalManager(broadcastSpy)
      expect(manager.isAvailable()).toBe(true)
    })

    it('returns false when ptyModule is null (node-pty unavailable)', () => {
      const manager = new TerminalManager(broadcastSpy)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ptyModule = null
      expect(manager.isAvailable()).toBe(false)
    })
  })

  describe('create()', () => {
    it('throws when node-pty is not available', () => {
      const manager = new TerminalManager(broadcastSpy)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ptyModule = null
      expect(() => manager.create()).toThrow('node-pty is not available')
    })

    it('throws at max 8 tabs', () => {
      const { manager } = createManagerWithSpy()

      for (let i = 0; i < 8; i++) {
        manager.create()
      }

      expect(() => manager.create()).toThrow('Maximum 8 terminal tabs reached')
    })

    it('strips CLAUDECODE and ANTHROPIC_API_KEY from env', () => {
      process.env.CLAUDECODE = 'secret-token'
      process.env.ANTHROPIC_API_KEY = 'sk-secret-key'

      const { manager, spawnSpy } = createManagerWithSpy()
      manager.create()

      const envArg = spawnSpy.mock.calls[0][2].env
      expect(envArg.CLAUDECODE).toBeUndefined()
      expect(envArg.ANTHROPIC_API_KEY).toBeUndefined()

      delete process.env.CLAUDECODE
      delete process.env.ANTHROPIC_API_KEY
    })

    it('returns a string termTabId', () => {
      const { manager } = createManagerWithSpy()
      const id = manager.create()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })
  })

  describe('output buffering', () => {
    it('flushes output buffer at 4ms intervals', () => {
      let onDataCallback: (data: string) => void = () => {}
      const { manager } = createManagerWithSpy(() => ({
        pid: 1,
        onData: vi.fn((cb: (data: string) => void) => {
          onDataCallback = cb
          return { dispose: vi.fn() }
        }),
        onExit: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
      }))

      const id = manager.create()
      onDataCallback('hello')

      // Not flushed yet
      expect(broadcastSpy).not.toHaveBeenCalledWith('clui:terminal-data', id, 'hello')

      // Advance past 4ms flush interval
      vi.advanceTimersByTime(5)

      expect(broadcastSpy).toHaveBeenCalledWith('clui:terminal-data', id, 'hello')
    })

    it('concatenates multiple chunks within 4ms into one broadcast', () => {
      let onDataCallback: (data: string) => void = () => {}
      const { manager } = createManagerWithSpy(() => ({
        pid: 1,
        onData: vi.fn((cb: (data: string) => void) => {
          onDataCallback = cb
          return { dispose: vi.fn() }
        }),
        onExit: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
      }))

      manager.create()
      onDataCallback('chunk1')
      onDataCallback('chunk2')
      onDataCallback('chunk3')

      vi.advanceTimersByTime(5)

      const dataCalls = broadcastSpy.mock.calls.filter(
        (c: unknown[]) => c[0] === 'clui:terminal-data'
      )
      expect(dataCalls).toHaveLength(1)
      expect(dataCalls[0][2]).toBe('chunk1chunk2chunk3')
    })
  })

  describe('close()', () => {
    it('disposes listeners and clears timer', () => {
      const disposeSpy = vi.fn()
      const { manager } = createManagerWithSpy(() => ({
        pid: 1,
        onData: vi.fn(() => ({ dispose: disposeSpy })),
        onExit: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
      }))

      const id = manager.create()
      manager.close(id)

      expect(disposeSpy).toHaveBeenCalled()
    })
  })

  describe('resize() and write() on non-existent ID', () => {
    it('resize on non-existent ID is a no-op (no throw)', () => {
      const manager = new TerminalManager(broadcastSpy)
      expect(() => manager.resize('non-existent-id', 80, 24)).not.toThrow()
    })

    it('write on non-existent ID is a no-op (no throw)', () => {
      const manager = new TerminalManager(broadcastSpy)
      expect(() => manager.write('non-existent-id', 'test')).not.toThrow()
    })
  })

  describe('shutdown()', () => {
    it('closes all active sessions', () => {
      const killSpy = vi.fn()
      const { manager } = createManagerWithSpy(() => ({
        pid: 1,
        onData: vi.fn(() => ({ dispose: vi.fn() })),
        onExit: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: killSpy,
      }))

      manager.create()
      manager.create()
      manager.create()

      manager.shutdown()

      expect(killSpy).toHaveBeenCalledTimes(3)
    })
  })

  describe('exit handler', () => {
    it('broadcasts correct exitCode on process exit', () => {
      let onExitCallback: (info: { exitCode: number }) => void = () => {}
      const { manager } = createManagerWithSpy(() => ({
        pid: 1,
        onData: vi.fn(() => ({ dispose: vi.fn() })),
        onExit: vi.fn((cb: (info: { exitCode: number }) => void) => {
          onExitCallback = cb
        }),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
      }))

      const id = manager.create()

      onExitCallback({ exitCode: 42 })

      expect(broadcastSpy).toHaveBeenCalledWith('clui:terminal-exit', id, 42)
    })
  })
})
