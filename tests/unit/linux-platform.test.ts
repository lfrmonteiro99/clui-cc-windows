import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mockPlatform } from '../helpers/mock-platform'
import * as childProcess from 'child_process'
import * as fs from 'fs'

/**
 * Tests for #261 LINUX-006: Fish shell detection and Linux Claude binary paths.
 */

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    accessSync: vi.fn(),
  }
})

const mockExecSync = vi.mocked(childProcess.execSync)
const mockExistsSync = vi.mocked(fs.existsSync)

import { findBinary, findClaudeBinary } from '../../src/main/platform'

describe('Linux platform support (#261)', () => {
  let restorePlatform: (() => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
  })

  afterEach(() => {
    restorePlatform?.()
    restorePlatform = null
  })

  describe('findBinary — fish shell detection', () => {
    it('tries fish shell after zsh and bash fail on Linux', () => {
      restorePlatform = mockPlatform('linux')
      const calls: string[] = []
      mockExecSync.mockImplementation((cmd: string) => {
        calls.push(String(cmd))
        if (String(cmd).includes('fish')) return '/usr/local/bin/claude\n'
        throw new Error('not found')
      })

      const result = findBinary('claude')

      expect(result).toBe('/usr/local/bin/claude')
      expect(calls.some(c => c.includes('fish'))).toBe(true)
    })

    it('fish shell is tried after zsh and bash on POSIX', () => {
      restorePlatform = mockPlatform('linux')
      const calls: string[] = []
      mockExecSync.mockImplementation((cmd: string) => {
        calls.push(String(cmd))
        throw new Error('not found')
      })

      findBinary('claude')

      // Should try zsh, bash, then fish
      expect(calls.length).toBe(3)
      expect(calls[0]).toContain('zsh')
      expect(calls[1]).toContain('bash')
      expect(calls[2]).toContain('fish')
    })

    it('uses type -P for fish shell lookup', () => {
      restorePlatform = mockPlatform('linux')
      mockExecSync.mockImplementation((cmd: string) => {
        if (String(cmd).includes('fish')) return '/usr/bin/claude\n'
        throw new Error('not found')
      })

      findBinary('claude')

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('type -P claude'),
        expect.anything(),
      )
    })

    it('does not try fish on Windows', () => {
      restorePlatform = mockPlatform('win32')
      mockExecSync.mockReturnValue('C:\\bin\\claude.exe\r\n')

      findBinary('claude')

      const calls = mockExecSync.mock.calls.map(c => String(c[0]))
      expect(calls.some(c => c.includes('fish'))).toBe(false)
    })
  })

  describe('findClaudeBinary — Linux candidate paths', () => {
    it('includes Linux-standard paths on linux', () => {
      restorePlatform = mockPlatform('linux')

      // Make /snap/bin/claude "exist"
      mockExistsSync.mockImplementation((p) => String(p) === '/snap/bin/claude')
      // accessSync succeeds (executable)
      const mockAccessSync = vi.mocked(fs.accessSync)
      mockAccessSync.mockImplementation(() => {})

      const result = findClaudeBinary()

      expect(result).toBe('/snap/bin/claude')
    })

    it('checks ~/.local/bin/claude on Linux', () => {
      restorePlatform = mockPlatform('linux')

      const home = require('os').homedir()
      const localBin = require('path').join(home, '.local/bin/claude')

      mockExistsSync.mockImplementation((p) => String(p) === localBin)
      const mockAccessSync = vi.mocked(fs.accessSync)
      mockAccessSync.mockImplementation(() => {})

      const result = findClaudeBinary()

      expect(result).toBe(localBin)
    })

    it('includes /usr/bin/claude and /usr/local/bin/claude on Linux', () => {
      restorePlatform = mockPlatform('linux')

      mockExistsSync.mockImplementation((p) => String(p) === '/usr/bin/claude')
      const mockAccessSync = vi.mocked(fs.accessSync)
      mockAccessSync.mockImplementation(() => {})

      const result = findClaudeBinary()

      expect(result).toBe('/usr/bin/claude')
    })
  })
})
