import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mockPlatform } from '../helpers/mock-platform'
import * as childProcess from 'child_process'
import * as fs from 'fs'

// Mock child_process and fs at the module level
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    accessSync: vi.fn(),
  }
})

const mockExecSync = vi.mocked(childProcess.execSync)
const mockExistsSync = vi.mocked(fs.existsSync)
const mockReadFileSync = vi.mocked(fs.readFileSync)

import { resolveClaudeEntryPoint } from '../../src/main/platform'

describe('resolveClaudeEntryPoint', () => {
  let restorePlatform: (() => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
  })

  afterEach(() => {
    restorePlatform?.()
    restorePlatform = null
  })

  describe('non-Windows', () => {
    it('returns findClaudeBinary + prefixArgs on darwin', () => {
      restorePlatform = mockPlatform('darwin')
      mockExecSync.mockReturnValue('/usr/local/bin/claude\n')

      const result = resolveClaudeEntryPoint()

      expect(result.binary).toBe('/usr/local/bin/claude')
      expect(result.prefixArgs).toEqual([])
    })

    it('returns findClaudeBinary + prefixArgs on linux', () => {
      restorePlatform = mockPlatform('linux')
      mockExecSync.mockReturnValue('/usr/bin/claude\n')

      const result = resolveClaudeEntryPoint()

      expect(result.binary).toBe('/usr/bin/claude')
      expect(result.prefixArgs).toEqual([])
    })
  })

  describe('Windows - resolves .cmd to node + cli.js', () => {
    const CMD_CONTENT = [
      '@IF EXIST "%~dp0\\node.exe" (',
      '  "%~dp0\\node.exe"  "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
      ') ELSE (',
      '  @SETLOCAL',
      '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
      '  node  "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
      ')',
    ].join('\r\n')

    it('returns node.exe + cli.js when .cmd is found and parseable', () => {
      restorePlatform = mockPlatform('win32')

      // findClaudeBinary returns a .cmd path
      mockExistsSync.mockImplementation((p) => {
        const s = String(p)
        if (s.endsWith('claude.cmd')) return true
        if (s.endsWith('cli.js')) return true
        return false
      })
      mockReadFileSync.mockReturnValue(CMD_CONTENT)

      const result = resolveClaudeEntryPoint()

      expect(result.binary).toBe('node.exe')
      expect(result.prefixArgs.length).toBe(1)
      expect(result.prefixArgs[0]).toMatch(/node_modules[\\/]@anthropic-ai[\\/]claude-code[\\/]cli\.js$/)
    })

    it('falls back to claude binary when .cmd file not found', () => {
      restorePlatform = mockPlatform('win32')

      // findClaudeBinary returns bare 'claude' (no .cmd found)
      mockExistsSync.mockReturnValue(false)
      mockExecSync.mockImplementation(() => { throw new Error('not found') })

      const result = resolveClaudeEntryPoint()

      // Should fall back to findClaudeBinary result
      expect(result.binary).toBe('claude')
      expect(result.prefixArgs).toEqual([])
    })

    it('falls back when .cmd content does not match expected pattern', () => {
      restorePlatform = mockPlatform('win32')

      mockExistsSync.mockImplementation((p) => String(p).endsWith('claude.cmd'))
      // .cmd content doesn't have the node_modules pattern
      mockReadFileSync.mockReturnValue('@echo off\nclaude.exe %*\n')

      const result = resolveClaudeEntryPoint()

      expect(result.binary).toContain('claude')
      expect(result.prefixArgs).toEqual([])
    })

    it('falls back when cli.js file does not exist on disk', () => {
      restorePlatform = mockPlatform('win32')

      mockExistsSync.mockImplementation((p) => {
        const s = String(p)
        // .cmd exists but cli.js does not
        if (s.endsWith('claude.cmd')) return true
        return false
      })
      mockReadFileSync.mockReturnValue(CMD_CONTENT)

      const result = resolveClaudeEntryPoint()

      // cli.js doesn't exist, so fallback
      expect(result.binary).toContain('claude')
      expect(result.prefixArgs).toEqual([])
    })

    it('does NOT match node_modules\\.bin\\claude shims', () => {
      restorePlatform = mockPlatform('win32')

      const shimContent = [
        '@IF EXIST "%~dp0\\node.exe" (',
        '  "%~dp0\\node.exe"  "%~dp0\\node_modules\\.bin\\claude" %*',
        ') ELSE (',
        '  node  "%~dp0\\node_modules\\.bin\\claude" %*',
        ')',
      ].join('\r\n')

      mockExistsSync.mockImplementation((p) => String(p).endsWith('claude.cmd'))
      mockReadFileSync.mockReturnValue(shimContent)

      const result = resolveClaudeEntryPoint()

      // Should NOT resolve to the shim — falls back
      expect(result.binary).toContain('claude')
      expect(result.prefixArgs).toEqual([])
    })

    it('tries %APPDATA%\\npm\\claude.cmd as second candidate', () => {
      restorePlatform = mockPlatform('win32')

      // findClaudeBinary returns something without .cmd extension
      mockExecSync.mockReturnValue('C:\\some\\path\\claude\n')
      // existsSync: the first candidate (findClaudeBinary + .cmd) doesn't exist
      // but the APPDATA one does, plus the cli.js
      let callCount = 0
      mockExistsSync.mockImplementation((p) => {
        const s = String(p)
        if (s.includes('AppData') && s.endsWith('claude.cmd')) return true
        if (s.endsWith('cli.js')) return true
        return false
      })
      mockReadFileSync.mockReturnValue(CMD_CONTENT)

      const result = resolveClaudeEntryPoint()

      expect(result.binary).toBe('node.exe')
      expect(result.prefixArgs[0]).toMatch(/cli\.js$/)
    })

    it('handles forward slashes in .cmd content', () => {
      restorePlatform = mockPlatform('win32')

      const cmdWithForwardSlashes = [
        '@IF EXIST "%~dp0\\node.exe" (',
        '  "%~dp0\\node.exe"  "%~dp0/node_modules/@anthropic-ai/claude-code/cli.js" %*',
        ') ELSE (',
        '  node  "%~dp0/node_modules/@anthropic-ai/claude-code/cli.js" %*',
        ')',
      ].join('\r\n')

      mockExistsSync.mockImplementation((p) => {
        const s = String(p)
        if (s.endsWith('claude.cmd')) return true
        if (s.endsWith('cli.js')) return true
        return false
      })
      mockReadFileSync.mockReturnValue(cmdWithForwardSlashes)

      const result = resolveClaudeEntryPoint()

      expect(result.binary).toBe('node.exe')
      expect(result.prefixArgs[0]).toMatch(/cli\.js$/)
    })
  })
})
