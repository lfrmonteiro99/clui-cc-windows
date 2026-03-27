import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { mockPlatform } from '../helpers/mock-platform'

// We need to mock child_process.execSync before importing the module
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}))

import { execSync } from 'child_process'
import { buildScreenshotCommand, getScreenshotTempPath, getLinuxScreenshotTool } from '../../src/main/screenshot'

const mockedExecSync = vi.mocked(execSync)

describe('screenshot', () => {
  let restorePlatform: (() => void) | null = null

  afterEach(() => {
    restorePlatform?.()
    restorePlatform = null
    vi.restoreAllMocks()
  })

  describe('buildScreenshotCommand', () => {
    it('uses screencapture on darwin', () => {
      restorePlatform = mockPlatform('darwin')
      const cmd = buildScreenshotCommand('/tmp/test.png')
      expect(cmd).not.toBeNull()
      expect(cmd!.program).toBe('/usr/sbin/screencapture')
      expect(cmd!.args).toContain('-i')
    })

    it('uses powershell on win32', () => {
      restorePlatform = mockPlatform('win32')
      const cmd = buildScreenshotCommand('C:\\temp\\test.png')
      expect(cmd).not.toBeNull()
      expect(cmd!.program).toBe('powershell')
      expect(cmd!.args.some(a => a.includes('System.Drawing'))).toBe(true)
    })

    it('delegates to getLinuxScreenshotTool on linux', () => {
      restorePlatform = mockPlatform('linux')
      // No tools available
      mockedExecSync.mockImplementation(() => {
        throw new Error('not found')
      })
      const cmd = buildScreenshotCommand('/tmp/test.png')
      expect(cmd).toBeNull()
    })
  })

  describe('getLinuxScreenshotTool', () => {
    let originalEnv: string | undefined

    beforeEach(() => {
      originalEnv = process.env.XDG_SESSION_TYPE
      mockedExecSync.mockReset()
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.XDG_SESSION_TYPE
      } else {
        process.env.XDG_SESSION_TYPE = originalEnv
      }
    })

    it('returns spectacle config when spectacle is available', () => {
      process.env.XDG_SESSION_TYPE = 'x11'
      mockedExecSync.mockImplementation((cmd) => {
        if (typeof cmd === 'string' && cmd === 'which spectacle') return Buffer.from('/usr/bin/spectacle')
        throw new Error('not found')
      })

      const result = getLinuxScreenshotTool('/tmp/test.png')
      expect(result).not.toBeNull()
      expect(result!.program).toBe('spectacle')
      expect(result!.args).toEqual(['-r', '-b', '-n', '-o', '/tmp/test.png'])
    })

    it('returns gnome-screenshot when gnome-screenshot is available', () => {
      process.env.XDG_SESSION_TYPE = 'x11'
      mockedExecSync.mockImplementation((cmd) => {
        if (typeof cmd === 'string' && cmd === 'which gnome-screenshot') return Buffer.from('/usr/bin/gnome-screenshot')
        throw new Error('not found')
      })

      const result = getLinuxScreenshotTool('/tmp/test.png')
      expect(result).not.toBeNull()
      expect(result!.program).toBe('gnome-screenshot')
      expect(result!.args).toEqual(['-a', '-f', '/tmp/test.png'])
    })

    it('returns flameshot when flameshot is available', () => {
      process.env.XDG_SESSION_TYPE = 'x11'
      mockedExecSync.mockImplementation((cmd) => {
        if (typeof cmd === 'string' && cmd === 'which flameshot') return Buffer.from('/usr/bin/flameshot')
        throw new Error('not found')
      })

      const result = getLinuxScreenshotTool('/tmp/test.png')
      expect(result).not.toBeNull()
      expect(result!.program).toBe('flameshot')
      expect(result!.args).toEqual(['gui', '--raw', '-p', '/tmp/test.png'])
    })

    it('returns scrot on X11 when scrot is available', () => {
      process.env.XDG_SESSION_TYPE = 'x11'
      mockedExecSync.mockImplementation((cmd) => {
        if (typeof cmd === 'string' && cmd === 'which scrot') return Buffer.from('/usr/bin/scrot')
        throw new Error('not found')
      })

      const result = getLinuxScreenshotTool('/tmp/test.png')
      expect(result).not.toBeNull()
      expect(result!.program).toBe('scrot')
      expect(result!.args).toEqual(['-s', '/tmp/test.png'])
    })

    it('skips scrot on Wayland', () => {
      process.env.XDG_SESSION_TYPE = 'wayland'
      // Only scrot is "available", but it should be skipped on Wayland
      mockedExecSync.mockImplementation((cmd) => {
        if (typeof cmd === 'string' && cmd === 'which scrot') return Buffer.from('/usr/bin/scrot')
        throw new Error('not found')
      })

      const result = getLinuxScreenshotTool('/tmp/test.png')
      // scrot was skipped, no other tools available
      expect(result).toBeNull()
    })

    it('returns grim on Wayland when grim is available', () => {
      process.env.XDG_SESSION_TYPE = 'wayland'
      mockedExecSync.mockImplementation((cmd) => {
        if (typeof cmd === 'string' && cmd === 'which grim') return Buffer.from('/usr/bin/grim')
        throw new Error('not found')
      })

      const result = getLinuxScreenshotTool('/tmp/test.png')
      expect(result).not.toBeNull()
      expect(result!.program).toBe('grim')
      expect(result!.args).toEqual(['-g', '$(slurp)', '/tmp/test.png'])
    })

    it('does not include grim on X11', () => {
      process.env.XDG_SESSION_TYPE = 'x11'
      // Only grim is "available", but it should be skipped on X11
      mockedExecSync.mockImplementation((cmd) => {
        if (typeof cmd === 'string' && cmd === 'which grim') return Buffer.from('/usr/bin/grim')
        throw new Error('not found')
      })

      const result = getLinuxScreenshotTool('/tmp/test.png')
      expect(result).toBeNull()
    })

    it('returns null when no tool is found', () => {
      process.env.XDG_SESSION_TYPE = 'x11'
      mockedExecSync.mockImplementation(() => {
        throw new Error('not found')
      })

      const result = getLinuxScreenshotTool('/tmp/test.png')
      expect(result).toBeNull()
    })

    it('detects Wayland via XDG_SESSION_TYPE', () => {
      process.env.XDG_SESSION_TYPE = 'wayland'
      // spectacle available on both, so it should be first
      mockedExecSync.mockImplementation((cmd) => {
        if (typeof cmd === 'string' && cmd === 'which spectacle') return Buffer.from('/usr/bin/spectacle')
        throw new Error('not found')
      })

      const result = getLinuxScreenshotTool('/tmp/test.png')
      expect(result).not.toBeNull()
      expect(result!.program).toBe('spectacle')
    })

    it('prefers spectacle over gnome-screenshot when both available', () => {
      process.env.XDG_SESSION_TYPE = 'x11'
      mockedExecSync.mockImplementation((cmd) => {
        if (typeof cmd === 'string' && (cmd === 'which spectacle' || cmd === 'which gnome-screenshot')) {
          return Buffer.from('/usr/bin/found')
        }
        throw new Error('not found')
      })

      const result = getLinuxScreenshotTool('/tmp/test.png')
      expect(result).not.toBeNull()
      expect(result!.program).toBe('spectacle')
    })
  })

  describe('getScreenshotTempPath', () => {
    it('returns a .png path in temp directory', () => {
      const p = getScreenshotTempPath()
      expect(p).toContain('.png')
      expect(p).toContain('clui-screenshot')
    })

    it('returns unique paths on successive calls', () => {
      const p1 = getScreenshotTempPath()
      const p2 = getScreenshotTempPath()
      expect(p1).not.toBe(p2)
    })
  })
})
