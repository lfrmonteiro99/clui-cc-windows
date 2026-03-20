import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mockPlatform } from '../../helpers/mock-platform'
import * as childProcess from 'child_process'

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}))

const mockExecSync = vi.mocked(childProcess.execSync)
const mockExecFileSync = vi.mocked(childProcess.execFileSync)

import {
  isWslAvailable,
  listWslDistros,
  getDefaultDistro,
  checkClaudeInWsl,
  convertPathToWsl,
  convertPathToWindows,
  detectRuntimeFromPath,
} from '../../../src/main/wsl/detection'

describe('WSL detection utilities', () => {
  let restorePlatform: (() => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    restorePlatform?.()
    restorePlatform = null
  })

  // ─── isWslAvailable ───

  describe('isWslAvailable', () => {
    it('returns true when wsl.exe --list --quiet succeeds on win32', () => {
      restorePlatform = mockPlatform('win32')
      mockExecSync.mockReturnValue(Buffer.from('Ubuntu\n', 'utf-8'))

      expect(isWslAvailable()).toBe(true)
      expect(mockExecSync).toHaveBeenCalledWith(
        'wsl.exe --list --quiet',
        expect.objectContaining({ timeout: expect.any(Number) }),
      )
    })

    it('returns false when wsl.exe throws on win32', () => {
      restorePlatform = mockPlatform('win32')
      mockExecSync.mockImplementation(() => { throw new Error('not found') })

      expect(isWslAvailable()).toBe(false)
    })

    it('returns false when wsl.exe returns empty output on win32', () => {
      restorePlatform = mockPlatform('win32')
      mockExecSync.mockReturnValue(Buffer.from('', 'utf-8'))

      expect(isWslAvailable()).toBe(false)
    })

    it('returns false on non-win32 platforms without calling wsl.exe', () => {
      restorePlatform = mockPlatform('darwin')

      expect(isWslAvailable()).toBe(false)
      expect(mockExecSync).not.toHaveBeenCalled()
    })

    it('returns false on linux platform', () => {
      restorePlatform = mockPlatform('linux')

      expect(isWslAvailable()).toBe(false)
      expect(mockExecSync).not.toHaveBeenCalled()
    })
  })

  // ─── listWslDistros ───

  describe('listWslDistros', () => {
    it('parses UTF-16LE BOM output from wsl.exe --list --verbose', () => {
      restorePlatform = mockPlatform('win32')

      // Simulate UTF-16LE output with BOM, as wsl.exe actually produces.
      // The text has columns: NAME, STATE, VERSION
      const text = [
        '  NAME                   STATE           VERSION',
        '* Ubuntu                 Running         2',
        '  Debian                 Stopped         1',
      ].join('\r\n')

      const buf = Buffer.from('\uFEFF' + text, 'utf16le')
      mockExecSync.mockReturnValue(buf)

      const distros = listWslDistros()

      expect(distros).toHaveLength(2)
      expect(distros[0]).toEqual({
        name: 'Ubuntu',
        isDefault: true,
        state: 'Running',
        version: 2,
      })
      expect(distros[1]).toEqual({
        name: 'Debian',
        isDefault: false,
        state: 'Stopped',
        version: 1,
      })
    })

    it('filters out docker-desktop distros', () => {
      restorePlatform = mockPlatform('win32')

      const text = [
        '  NAME                   STATE           VERSION',
        '* Ubuntu                 Running         2',
        '  docker-desktop         Running         2',
        '  docker-desktop-data    Running         2',
      ].join('\r\n')

      const buf = Buffer.from('\uFEFF' + text, 'utf16le')
      mockExecSync.mockReturnValue(buf)

      const distros = listWslDistros()

      expect(distros).toHaveLength(1)
      expect(distros[0].name).toBe('Ubuntu')
    })

    it('returns empty array when wsl.exe throws', () => {
      restorePlatform = mockPlatform('win32')
      mockExecSync.mockImplementation(() => { throw new Error('not found') })

      expect(listWslDistros()).toEqual([])
    })

    it('returns empty array on non-win32', () => {
      restorePlatform = mockPlatform('darwin')

      expect(listWslDistros()).toEqual([])
      expect(mockExecSync).not.toHaveBeenCalled()
    })

    it('handles output without BOM', () => {
      restorePlatform = mockPlatform('win32')

      const text = [
        '  NAME                   STATE           VERSION',
        '* Ubuntu                 Running         2',
      ].join('\r\n')

      // UTF-16LE without BOM
      const buf = Buffer.from(text, 'utf16le')
      mockExecSync.mockReturnValue(buf)

      const distros = listWslDistros()

      expect(distros).toHaveLength(1)
      expect(distros[0].name).toBe('Ubuntu')
    })

    it('handles Installing state', () => {
      restorePlatform = mockPlatform('win32')

      const text = [
        '  NAME                   STATE           VERSION',
        '  Fedora                 Installing      2',
      ].join('\r\n')

      const buf = Buffer.from('\uFEFF' + text, 'utf16le')
      mockExecSync.mockReturnValue(buf)

      const distros = listWslDistros()

      expect(distros).toHaveLength(1)
      expect(distros[0]).toEqual({
        name: 'Fedora',
        isDefault: false,
        state: 'Installing',
        version: 2,
      })
    })

    it('skips lines that do not match expected format', () => {
      restorePlatform = mockPlatform('win32')

      const text = [
        '  NAME                   STATE           VERSION',
        '* Ubuntu                 Running         2',
        '',
        'some garbage line',
      ].join('\r\n')

      const buf = Buffer.from('\uFEFF' + text, 'utf16le')
      mockExecSync.mockReturnValue(buf)

      const distros = listWslDistros()

      expect(distros).toHaveLength(1)
    })
  })

  // ─── getDefaultDistro ───

  describe('getDefaultDistro', () => {
    it('returns the default distro name', () => {
      restorePlatform = mockPlatform('win32')

      const text = [
        '  NAME                   STATE           VERSION',
        '* Ubuntu                 Running         2',
        '  Debian                 Stopped         1',
      ].join('\r\n')

      const buf = Buffer.from('\uFEFF' + text, 'utf16le')
      mockExecSync.mockReturnValue(buf)

      expect(getDefaultDistro()).toBe('Ubuntu')
    })

    it('returns null when no default distro is marked', () => {
      restorePlatform = mockPlatform('win32')

      const text = [
        '  NAME                   STATE           VERSION',
        '  Ubuntu                 Running         2',
      ].join('\r\n')

      const buf = Buffer.from('\uFEFF' + text, 'utf16le')
      mockExecSync.mockReturnValue(buf)

      expect(getDefaultDistro()).toBe(null)
    })

    it('returns null when listWslDistros returns empty', () => {
      restorePlatform = mockPlatform('win32')
      mockExecSync.mockImplementation(() => { throw new Error('fail') })

      expect(getDefaultDistro()).toBe(null)
    })

    it('returns null on non-win32', () => {
      restorePlatform = mockPlatform('darwin')

      expect(getDefaultDistro()).toBe(null)
    })
  })

  // ─── checkClaudeInWsl ───

  describe('checkClaudeInWsl', () => {
    it('returns true when which claude succeeds', () => {
      restorePlatform = mockPlatform('win32')
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin/claude\n'))

      expect(checkClaudeInWsl('Ubuntu')).toBe(true)
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'wsl.exe',
        ['-d', 'Ubuntu', '--', 'which', 'claude'],
        expect.objectContaining({ timeout: expect.any(Number) }),
      )
    })

    it('returns false when which claude fails', () => {
      restorePlatform = mockPlatform('win32')
      mockExecFileSync.mockImplementation(() => { throw new Error('not found') })

      expect(checkClaudeInWsl('Ubuntu')).toBe(false)
    })

    it('uses execFileSync to prevent shell injection', () => {
      restorePlatform = mockPlatform('win32')
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin/claude\n'))

      checkClaudeInWsl('Ubuntu; rm -rf /')

      // Should use execFileSync (not execSync) with distro as array element
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'wsl.exe',
        ['-d', 'Ubuntu; rm -rf /', '--', 'which', 'claude'],
        expect.anything(),
      )
      expect(mockExecSync).not.toHaveBeenCalled()
    })

    it('returns false on non-win32', () => {
      restorePlatform = mockPlatform('darwin')

      expect(checkClaudeInWsl('Ubuntu')).toBe(false)
      expect(mockExecFileSync).not.toHaveBeenCalled()
    })
  })

  // ─── convertPathToWsl ───

  describe('convertPathToWsl', () => {
    it('converts Windows drive path C:\\ to /mnt/c/', () => {
      expect(convertPathToWsl('C:\\Users\\me\\project')).toBe('/mnt/c/Users/me/project')
    })

    it('converts lowercase drive letter', () => {
      expect(convertPathToWsl('c:\\Users\\me')).toBe('/mnt/c/Users/me')
    })

    it('converts D:\\ drive', () => {
      expect(convertPathToWsl('D:\\dev\\code')).toBe('/mnt/d/dev/code')
    })

    it('handles \\\\wsl$\\ UNC path (Windows 10 format)', () => {
      expect(convertPathToWsl('\\\\wsl$\\Ubuntu\\home\\me')).toBe('/home/me')
    })

    it('handles \\\\wsl.localhost\\ UNC path (Windows 11 format)', () => {
      expect(convertPathToWsl('\\\\wsl.localhost\\Ubuntu\\home\\me')).toBe('/home/me')
    })

    it('passes through already-linux paths unchanged', () => {
      expect(convertPathToWsl('/home/me/project')).toBe('/home/me/project')
    })

    it('passes through /mnt/ paths unchanged', () => {
      expect(convertPathToWsl('/mnt/c/Users/me')).toBe('/mnt/c/Users/me')
    })

    it('handles root drive path C:\\', () => {
      expect(convertPathToWsl('C:\\')).toBe('/mnt/c/')
    })

    it('handles forward slashes in Windows paths', () => {
      expect(convertPathToWsl('C:/Users/me/project')).toBe('/mnt/c/Users/me/project')
    })

    it('handles \\\\wsl$\\ with just distro name (root)', () => {
      expect(convertPathToWsl('\\\\wsl$\\Ubuntu')).toBe('/')
    })

    it('handles \\\\wsl.localhost\\ with just distro name (root)', () => {
      expect(convertPathToWsl('\\\\wsl.localhost\\Ubuntu')).toBe('/')
    })
  })

  // ─── convertPathToWindows ───

  describe('convertPathToWindows', () => {
    it('converts /mnt/c/... to C:\\...', () => {
      expect(convertPathToWindows('/mnt/c/Users/me/project', 'Ubuntu')).toBe('C:\\Users\\me\\project')
    })

    it('converts /mnt/d/... to D:\\...', () => {
      expect(convertPathToWindows('/mnt/d/dev', 'Ubuntu')).toBe('D:\\dev')
    })

    it('converts non-mnt Linux paths to \\\\wsl.localhost\\<distro>\\...', () => {
      expect(convertPathToWindows('/home/me/project', 'Ubuntu')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me\\project')
    })

    it('converts root path to \\\\wsl.localhost\\<distro>\\', () => {
      expect(convertPathToWindows('/', 'Ubuntu')).toBe('\\\\wsl.localhost\\Ubuntu\\')
    })

    it('converts /mnt/c/ (root) to C:\\', () => {
      expect(convertPathToWindows('/mnt/c/', 'Ubuntu')).toBe('C:\\')
    })

    it('uppercases the drive letter', () => {
      expect(convertPathToWindows('/mnt/c/foo', 'Ubuntu')).toBe('C:\\foo')
    })
  })

  // ─── detectRuntimeFromPath ───

  describe('detectRuntimeFromPath', () => {
    it('detects native for Windows drive paths', () => {
      expect(detectRuntimeFromPath('C:\\Users\\me')).toBe('native')
    })

    it('detects native for /mnt/ paths (mounted Windows drives)', () => {
      expect(detectRuntimeFromPath('/mnt/c/Users/me')).toBe('native')
    })

    it('detects wsl for absolute Linux paths not under /mnt/', () => {
      expect(detectRuntimeFromPath('/home/me/project')).toBe('wsl')
    })

    it('detects wsl for /usr/... paths', () => {
      expect(detectRuntimeFromPath('/usr/local/bin')).toBe('wsl')
    })

    it('detects wsl for \\\\wsl$\\ UNC paths', () => {
      expect(detectRuntimeFromPath('\\\\wsl$\\Ubuntu\\home\\me')).toBe('wsl')
    })

    it('detects wsl for \\\\wsl.localhost\\ UNC paths', () => {
      expect(detectRuntimeFromPath('\\\\wsl.localhost\\Ubuntu\\home\\me')).toBe('wsl')
    })

    it('detects native for relative paths', () => {
      expect(detectRuntimeFromPath('some/relative/path')).toBe('native')
    })

    it('detects native for ~ home shorthand', () => {
      expect(detectRuntimeFromPath('~')).toBe('native')
    })

    it('detects native for empty string', () => {
      expect(detectRuntimeFromPath('')).toBe('native')
    })
  })
})
