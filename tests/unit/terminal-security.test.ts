/**
 * TERM-013: Terminal security tests (Priority 3)
 *
 * Validates that sensitive environment variables are never passed to PTY
 * processes, and that shell spawning uses safe execution methods.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock node-pty so require('node-pty') succeeds in the TerminalManager constructor
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

describe('Terminal security', () => {
  let TerminalManager: typeof import('../../src/main/terminal/terminal-manager').TerminalManager
  let broadcastSpy: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    broadcastSpy = vi.fn()
    const mod = await import('../../src/main/terminal/terminal-manager')
    TerminalManager = mod.TerminalManager
  })

  afterEach(() => {
    delete process.env.CLAUDECODE
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.MY_SAFE_VAR
  })

  /**
   * Helper: creates a manager with a spied-on spawn function so we can
   * inspect the arguments passed to node-pty.spawn().
   */
  function createManagerWithSpawnSpy() {
    const manager = new TerminalManager(broadcastSpy)
    const spawnSpy = vi.fn((..._args: unknown[]) => ({
      pid: 1,
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(manager as any).ptyModule = { spawn: spawnSpy }
    return { manager, spawnSpy }
  }

  describe('PTY env never contains CLAUDECODE or ANTHROPIC_API_KEY', () => {
    it('strips CLAUDECODE from PTY environment', () => {
      process.env.CLAUDECODE = 'secret-hook-token'

      const { manager, spawnSpy } = createManagerWithSpawnSpy()
      manager.create()

      const envPassed = spawnSpy.mock.calls[0][2].env
      expect(envPassed).not.toHaveProperty('CLAUDECODE')
    })

    it('strips ANTHROPIC_API_KEY from PTY environment', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-key-12345'

      const { manager, spawnSpy } = createManagerWithSpawnSpy()
      manager.create()

      const envPassed = spawnSpy.mock.calls[0][2].env
      expect(envPassed).not.toHaveProperty('ANTHROPIC_API_KEY')
    })

    it('strips both sensitive vars when both are present', () => {
      process.env.CLAUDECODE = 'token'
      process.env.ANTHROPIC_API_KEY = 'key'

      const { manager, spawnSpy } = createManagerWithSpawnSpy()
      manager.create()

      const envPassed = spawnSpy.mock.calls[0][2].env
      expect(envPassed).not.toHaveProperty('CLAUDECODE')
      expect(envPassed).not.toHaveProperty('ANTHROPIC_API_KEY')
    })

    it('preserves other environment variables', () => {
      process.env.CLAUDECODE = 'secret'
      process.env.MY_SAFE_VAR = 'safe-value'

      const { manager, spawnSpy } = createManagerWithSpawnSpy()
      manager.create()

      const envPassed = spawnSpy.mock.calls[0][2].env
      expect(envPassed.MY_SAFE_VAR).toBe('safe-value')
    })
  })

  describe('Shell option cannot inject metacharacters (execFile not shell)', () => {
    it('node-pty spawn is called without shell:true option', () => {
      const { manager, spawnSpy } = createManagerWithSpawnSpy()
      manager.create({ shell: '/bin/bash' })

      const [shellArg, argsArg, optionsArg] = spawnSpy.mock.calls[0]
      expect(shellArg).toBe('/bin/bash')
      expect(argsArg).toEqual([])
      // The options should NOT contain a 'shell' flag (like child_process shell:true)
      expect(optionsArg.shell).toBeUndefined()
    })

    it('shell with special characters is passed as program name not interpreted', () => {
      const { manager, spawnSpy } = createManagerWithSpawnSpy()
      manager.create({ shell: '/bin/bash; rm -rf /' })

      const [shellArg] = spawnSpy.mock.calls[0]
      expect(shellArg).toBe('/bin/bash; rm -rf /')
    })

    it('uses xterm-256color as terminal name (not raw shell)', () => {
      const { manager, spawnSpy } = createManagerWithSpawnSpy()
      manager.create()

      const options = spawnSpy.mock.calls[0][2]
      expect(options.name).toBe('xterm-256color')
    })
  })
})
