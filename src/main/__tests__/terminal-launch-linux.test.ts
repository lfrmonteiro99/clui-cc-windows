import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import {
  findLinuxTerminal,
  clearTerminalCache,
  buildLinuxTerminalCommand,
  type LinuxTerminalInfo,
} from '../terminal-launch'

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}))

const mockedExecSync = vi.mocked(execSync)

describe('findLinuxTerminal', () => {
  const originalEnv = process.env

  beforeEach(() => {
    clearTerminalCache()
    process.env = { ...originalEnv }
    delete process.env.TERMINAL
    mockedExecSync.mockReset()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('respects $TERMINAL env var when set and binary exists', () => {
    process.env.TERMINAL = 'alacritty'
    mockedExecSync.mockReturnValueOnce(Buffer.from('/usr/bin/alacritty\n'))

    const result = findLinuxTerminal()
    expect(result.program).toBe('alacritty')
  })

  it('falls back to candidate list when $TERMINAL binary not found', () => {
    process.env.TERMINAL = 'nonexistent-terminal'
    // $TERMINAL check fails
    mockedExecSync.mockImplementation((cmd: string | Buffer) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString()
      if (cmdStr.includes('nonexistent-terminal')) {
        throw new Error('not found')
      }
      if (cmdStr.includes('x-terminal-emulator')) {
        return Buffer.from('/usr/bin/x-terminal-emulator\n')
      }
      throw new Error('not found')
    })

    const result = findLinuxTerminal()
    expect(result.program).toBe('x-terminal-emulator')
  })

  it('walks the fallback chain until a terminal is found', () => {
    // x-terminal-emulator not found, konsole not found, gnome-terminal found
    mockedExecSync.mockImplementation((cmd: string | Buffer) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString()
      if (cmdStr.includes('gnome-terminal')) {
        return Buffer.from('/usr/bin/gnome-terminal\n')
      }
      throw new Error('not found')
    })

    const result = findLinuxTerminal()
    expect(result.program).toBe('gnome-terminal')
    expect(result.execFlag).toBe('--')
  })

  it('returns xterm as final fallback', () => {
    mockedExecSync.mockImplementation((cmd: string | Buffer) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString()
      if (cmdStr.includes('xterm')) {
        return Buffer.from('/usr/bin/xterm\n')
      }
      throw new Error('not found')
    })

    const result = findLinuxTerminal()
    expect(result.program).toBe('xterm')
    expect(result.execFlag).toBe('-e')
  })

  it('caches the result across calls', () => {
    mockedExecSync.mockImplementation((cmd: string | Buffer) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString()
      if (cmdStr.includes('x-terminal-emulator')) {
        return Buffer.from('/usr/bin/x-terminal-emulator\n')
      }
      throw new Error('not found')
    })

    const first = findLinuxTerminal()
    const second = findLinuxTerminal()

    expect(first).toBe(second)
    // execSync should only have been called during first detection
    // After cache, no more calls
    const callCountAfterFirst = mockedExecSync.mock.calls.length
    findLinuxTerminal()
    expect(mockedExecSync.mock.calls.length).toBe(callCountAfterFirst)
  })

  it('returns correct execFlag for konsole (-e)', () => {
    mockedExecSync.mockImplementation((cmd: string | Buffer) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString()
      if (cmdStr.includes('konsole')) {
        return Buffer.from('/usr/bin/konsole\n')
      }
      throw new Error('not found')
    })

    const result = findLinuxTerminal()
    expect(result.program).toBe('konsole')
    expect(result.execFlag).toBe('-e')
  })

  it('returns correct execFlag for gnome-terminal (--)', () => {
    mockedExecSync.mockImplementation((cmd: string | Buffer) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString()
      if (cmdStr.includes('gnome-terminal')) {
        return Buffer.from('/usr/bin/gnome-terminal\n')
      }
      throw new Error('not found')
    })

    const result = findLinuxTerminal()
    expect(result.program).toBe('gnome-terminal')
    expect(result.execFlag).toBe('--')
  })

  it('returns correct execFlag for kitty (no flag)', () => {
    mockedExecSync.mockImplementation((cmd: string | Buffer) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString()
      if (cmdStr.includes('kitty')) {
        return Buffer.from('/usr/bin/kitty\n')
      }
      throw new Error('not found')
    })

    const result = findLinuxTerminal()
    expect(result.program).toBe('kitty')
    expect(result.execFlag).toBeNull()
  })

  it('returns correct execFlag for alacritty (-e)', () => {
    mockedExecSync.mockImplementation((cmd: string | Buffer) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString()
      if (cmdStr.includes('alacritty')) {
        return Buffer.from('/usr/bin/alacritty\n')
      }
      throw new Error('not found')
    })

    const result = findLinuxTerminal()
    expect(result.program).toBe('alacritty')
    expect(result.execFlag).toBe('-e')
  })

  it('returns correct execFlag for wezterm (-e)', () => {
    mockedExecSync.mockImplementation((cmd: string | Buffer) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString()
      if (cmdStr.includes('wezterm')) {
        return Buffer.from('/usr/bin/wezterm\n')
      }
      throw new Error('not found')
    })

    const result = findLinuxTerminal()
    expect(result.program).toBe('wezterm')
    expect(result.execFlag).toBe('-e')
  })

  it('throws when no terminal is found at all', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found')
    })

    expect(() => findLinuxTerminal()).toThrow('No terminal emulator found')
  })
})

describe('buildLinuxTerminalCommand', () => {
  beforeEach(() => {
    clearTerminalCache()
    mockedExecSync.mockReset()
  })

  it('builds correct args for terminals with -e flag', () => {
    const info: LinuxTerminalInfo = { program: 'konsole', execFlag: '-e' }
    const result = buildLinuxTerminalCommand(info, '/home/user/project', 'claude')

    expect(result.program).toBe('konsole')
    expect(result.args[0]).toBe('-e')
    expect(result.args[1]).toContain('cd "/home/user/project"')
    expect(result.args[1]).toContain('claude')
  })

  it('builds correct args for gnome-terminal with -- flag', () => {
    const info: LinuxTerminalInfo = { program: 'gnome-terminal', execFlag: '--' }
    const result = buildLinuxTerminalCommand(info, '/home/user/project', 'claude')

    expect(result.program).toBe('gnome-terminal')
    expect(result.args[0]).toBe('--')
    expect(result.args[1]).toContain('cd "/home/user/project"')
  })

  it('builds correct args for kitty with no flag (appends command directly)', () => {
    const info: LinuxTerminalInfo = { program: 'kitty', execFlag: null }
    const result = buildLinuxTerminalCommand(info, '/home/user/project', 'claude')

    expect(result.program).toBe('kitty')
    expect(result.args[0]).not.toBe('-e')
    expect(result.args[0]).not.toBe('--')
    expect(result.args).toContain('bash')
    expect(result.args.some((a) => a.includes('cd "/home/user/project"'))).toBe(true)
  })

  it('escapes double quotes in project path', () => {
    const info: LinuxTerminalInfo = { program: 'xterm', execFlag: '-e' }
    const result = buildLinuxTerminalCommand(info, '/home/user/my "project"', 'claude')

    expect(result.args[1]).toContain('\\"')
  })
})
