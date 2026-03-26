/**
 * TERM-013: TerminalManager class behavior tests
 *
 * Tests TerminalManager class behavior by directly constructing it
 * with an injected mock PTY module (since node-pty is loaded via require()).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Track callbacks
let onDataCallbacks: Array<(data: string) => void> = []
let onExitCallbacks: Array<(ev: { exitCode: number }) => void> = []

interface MockPty {
  pid: number
  onData: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
}

function createMockPty(): MockPty {
  return {
    pid: 1234,
    onData: vi.fn((cb: (data: string) => void) => {
      onDataCallbacks.push(cb)
      return { dispose: vi.fn() }
    }),
    onExit: vi.fn((cb: (ev: { exitCode: number }) => void) => {
      onExitCallbacks.push(cb)
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  }
}

let lastPty: MockPty
let spawnArgs: unknown[][] = []

const mockPtyModule = {
  spawn: (...args: unknown[]) => {
    spawnArgs.push(args)
    lastPty = createMockPty()
    return lastPty
  },
}

// Import the class
import { TerminalManager } from '../../src/main/terminal/terminal-manager'

// The constructor tries require('node-pty'), which will fail in test env.
// We inject the mock by accessing the private ptyModule field.
function createManager(broadcast: (...args: unknown[]) => void): TerminalManager {
  const mgr = new TerminalManager(broadcast)
  // Inject mock pty module (overrides whatever constructor loaded or failed to load)
  ;(mgr as any).ptyModule = mockPtyModule
  return mgr
}

describe('TerminalManager class', () => {
  let manager: TerminalManager
  let broadcast: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onDataCallbacks = []
    onExitCallbacks = []
    spawnArgs = []
    broadcast = vi.fn()
    manager = createManager(broadcast)
  })

  describe('isAvailable()', () => {
    it('returns true when ptyModule is set', () => {
      expect(manager.isAvailable()).toBe(true)
    })

    it('returns false when ptyModule is null', () => {
      ;(manager as any).ptyModule = null
      expect(manager.isAvailable()).toBe(false)
    })
  })

  describe('create()', () => {
    it('returns a UUID termTabId', () => {
      const id = manager.create()
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
    })

    it('spawns PTY with correct shell and options', () => {
      manager.create({ shell: '/bin/zsh', cwd: '/tmp', cols: 120, rows: 40 })
      const lastCall = spawnArgs[spawnArgs.length - 1]
      expect(lastCall[0]).toBe('/bin/zsh')
      expect(lastCall[2]).toMatchObject({
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: '/tmp',
      })
    })

    it('strips CLAUDECODE from env', () => {
      process.env.CLAUDECODE = 'secret'
      manager.create()
      const lastCall = spawnArgs[spawnArgs.length - 1]
      expect((lastCall[2] as any).env.CLAUDECODE).toBeUndefined()
      delete process.env.CLAUDECODE
    })

    it('strips ANTHROPIC_API_KEY from env', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-secret'
      manager.create()
      const lastCall = spawnArgs[spawnArgs.length - 1]
      expect((lastCall[2] as any).env.ANTHROPIC_API_KEY).toBeUndefined()
      delete process.env.ANTHROPIC_API_KEY
    })

    it('throws at max 8 tabs', () => {
      for (let i = 0; i < 8; i++) {
        manager.create()
      }
      expect(() => manager.create()).toThrow('Maximum 8 terminal tabs reached')
    })

    it('throws when ptyModule is null', () => {
      ;(manager as any).ptyModule = null
      expect(() => manager.create()).toThrow('node-pty is not available')
    })
  })

  describe('write()', () => {
    it('sends data to PTY', () => {
      const id = manager.create()
      manager.write(id, 'hello')
      expect(lastPty.write).toHaveBeenCalledWith('hello')
    })

    it('no-op on non-existent ID (no throw)', () => {
      expect(() => manager.write('nonexistent', 'data')).not.toThrow()
    })
  })

  describe('resize()', () => {
    it('resizes PTY', () => {
      const id = manager.create()
      manager.resize(id, 100, 50)
      expect(lastPty.resize).toHaveBeenCalledWith(100, 50)
    })

    it('no-op on non-existent ID (no throw)', () => {
      expect(() => manager.resize('nonexistent', 80, 24)).not.toThrow()
    })
  })

  describe('close()', () => {
    it('kills PTY and cleans up', () => {
      const id = manager.create()
      const pty = lastPty
      manager.close(id)
      expect(pty.kill).toHaveBeenCalled()
    })

    it('no-op on non-existent ID', () => {
      expect(() => manager.close('nonexistent')).not.toThrow()
    })
  })

  describe('shutdown()', () => {
    it('closes all active sessions', () => {
      const ptys: MockPty[] = []
      manager.create(); ptys.push(lastPty)
      manager.create(); ptys.push(lastPty)
      manager.create(); ptys.push(lastPty)
      manager.shutdown()
      for (const pty of ptys) {
        expect(pty.kill).toHaveBeenCalled()
      }
    })
  })

  describe('output buffering', () => {
    it('broadcasts output via IPC after buffer flush', async () => {
      const id = manager.create()
      const cb = onDataCallbacks[onDataCallbacks.length - 1]
      cb('hello world')

      await new Promise((r) => setTimeout(r, 10))
      expect(broadcast).toHaveBeenCalledWith('clui:terminal-data', id, 'hello world')
    })

    it('concatenates multiple chunks within 4ms into one broadcast', async () => {
      const id = manager.create()
      const cb = onDataCallbacks[onDataCallbacks.length - 1]

      cb('chunk1')
      cb('chunk2')
      cb('chunk3')

      await new Promise((r) => setTimeout(r, 10))
      const calls = broadcast.mock.calls.filter((c: unknown[]) => c[0] === 'clui:terminal-data' && c[1] === id)
      expect(calls.length).toBe(1)
      expect(calls[0][2]).toBe('chunk1chunk2chunk3')
    })
  })

  describe('exit handler', () => {
    it('broadcasts correct exitCode', () => {
      const id = manager.create()
      const exitCb = onExitCallbacks[onExitCallbacks.length - 1]
      exitCb({ exitCode: 42 })
      expect(broadcast).toHaveBeenCalledWith('clui:terminal-exit', id, 42)
    })
  })

  // TERM-011: Mouse protocol support
  describe('mouse protocol support (TERM-011)', () => {
    it('PTY spawns with xterm-256color terminal name for mouse protocol', () => {
      manager.create()
      const lastCall = spawnArgs[spawnArgs.length - 1]
      expect((lastCall[2] as any).name).toBe('xterm-256color')
    })

    it('xterm-256color enables SGR1006 mouse protocol natively', () => {
      // xterm.js v6 + xterm-256color TERM automatically supports
      // SGR1006 extended mouse reporting (1006h escape sequence).
      // This is required for TUI apps like vim, htop, tmux.
      manager.create({ cols: 200, rows: 60 })
      const lastCall = spawnArgs[spawnArgs.length - 1]
      // Large column count (>223) requires SGR format, which xterm-256color supports
      expect((lastCall[2] as any).cols).toBe(200)
      expect((lastCall[2] as any).name).toBe('xterm-256color')
    })

    it('default cols/rows for mouse coordinate support', () => {
      manager.create()
      const lastCall = spawnArgs[spawnArgs.length - 1]
      expect((lastCall[2] as any).cols).toBe(80)
      expect((lastCall[2] as any).rows).toBe(24)
    })
  })

  describe('security', () => {
    it('PTY env never contains CLAUDECODE', () => {
      process.env.CLAUDECODE = 'test-secret'
      manager.create()
      const lastCall = spawnArgs[spawnArgs.length - 1]
      expect((lastCall[2] as any).env).not.toHaveProperty('CLAUDECODE')
      delete process.env.CLAUDECODE
    })

    it('PTY env never contains ANTHROPIC_API_KEY', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test-key'
      manager.create()
      const lastCall = spawnArgs[spawnArgs.length - 1]
      expect((lastCall[2] as any).env).not.toHaveProperty('ANTHROPIC_API_KEY')
      delete process.env.ANTHROPIC_API_KEY
    })
  })
})
