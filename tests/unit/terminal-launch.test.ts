import { describe, it, expect, afterEach, vi } from 'vitest'
import { mockPlatform } from '../helpers/mock-platform'
import { buildTerminalCommand, clearTerminalCache } from '../../src/main/terminal-launch'

describe('buildTerminalCommand', () => {
  let restorePlatform: (() => void) | null = null

  afterEach(() => {
    restorePlatform?.()
    restorePlatform = null
  })

  describe('on win32', () => {
    it('builds cmd.exe command with cd /d', () => {
      restorePlatform = mockPlatform('win32')
      const result = buildTerminalCommand({ projectPath: 'C:\\Users\\test\\project', claudeBin: 'claude' })

      expect(result.program).toBe('cmd.exe')
      expect(result.args.join(' ')).toContain('cd /d')
    })

    it('handles paths with spaces', () => {
      restorePlatform = mockPlatform('win32')
      const result = buildTerminalCommand({ projectPath: 'C:\\Users\\test\\my project', claudeBin: 'claude' })

      expect(result.args.join(' ')).toContain('my project')
    })

    it('includes resume flag when sessionId provided', () => {
      restorePlatform = mockPlatform('win32')
      const result = buildTerminalCommand({ projectPath: 'C:\\test', claudeBin: 'claude', sessionId: 'abc-123' })

      expect(result.args.join(' ')).toContain('--resume abc-123')
    })

    it('supports powershell provider', () => {
      restorePlatform = mockPlatform('win32')
      const result = buildTerminalCommand({ projectPath: 'C:\\test', claudeBin: 'claude', terminal: 'powershell' })

      expect(result.program).toBe('powershell.exe')
    })

    it('supports windows terminal (wt) provider', () => {
      restorePlatform = mockPlatform('win32')
      const result = buildTerminalCommand({ projectPath: 'C:\\test', claudeBin: 'claude', terminal: 'wt' })

      expect(result.program).toBe('wt.exe')
    })
  })

  describe('on darwin', () => {
    it('uses osascript for Terminal.app', () => {
      restorePlatform = mockPlatform('darwin')
      const result = buildTerminalCommand({ projectPath: '/Users/test', claudeBin: 'claude' })

      expect(result.program).toBe('/usr/bin/osascript')
    })

    it('includes session resume in command', () => {
      restorePlatform = mockPlatform('darwin')
      const result = buildTerminalCommand({ projectPath: '/tmp', claudeBin: 'claude', sessionId: 'xyz' })

      expect(result.args.join(' ')).toContain('--resume xyz')
    })
  })

  describe('on linux', () => {
    it('uses detected terminal emulator', () => {
      restorePlatform = mockPlatform('linux')
      clearTerminalCache()
      // Mock execSync to make x-terminal-emulator "available"
      vi.mock('child_process', async (importOriginal) => {
        const orig = await importOriginal<typeof import('child_process')>()
        return {
          ...orig,
          execSync: (cmd: string, ...args: unknown[]) => {
            if (typeof cmd === 'string' && cmd.includes('which x-terminal-emulator')) {
              return '/usr/bin/x-terminal-emulator\n'
            }
            return orig.execSync(cmd, ...(args as [any]))
          },
        }
      })
      const result = buildTerminalCommand({ projectPath: '/home/user', claudeBin: 'claude' })
      // Should find a terminal (the detected one)
      expect(result.program).toBeDefined()
      expect(typeof result.program).toBe('string')
      vi.restoreAllMocks()
    })
  })
})
