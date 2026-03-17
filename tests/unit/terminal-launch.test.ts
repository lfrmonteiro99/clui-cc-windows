import { describe, it, expect, afterEach } from 'vitest'
import { mockPlatform } from '../helpers/mock-platform'
import { buildTerminalCommand } from '../../src/main/terminal-launch'

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
    it('uses x-terminal-emulator', () => {
      restorePlatform = mockPlatform('linux')
      const result = buildTerminalCommand({ projectPath: '/home/user', claudeBin: 'claude' })

      expect(result.program).toBe('x-terminal-emulator')
    })
  })
})
