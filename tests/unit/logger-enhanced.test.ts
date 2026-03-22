/**
 * TDD RED tests for always-on logging with levels and rotation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    appendFile: vi.fn((_path: string, _data: string, cb: () => void) => cb()),
    appendFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    statSync: vi.fn(() => ({ size: 0 })),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
  }
})

const mockAppendFile = vi.mocked(fs.appendFile)
const mockAppendFileSync = vi.mocked(fs.appendFileSync)
const mockExistsSync = vi.mocked(fs.existsSync)
const mockStatSync = vi.mocked(fs.statSync)
const mockRenameSync = vi.mocked(fs.renameSync)
const mockUnlinkSync = vi.mocked(fs.unlinkSync)

describe('enhanced logger', () => {
  let originalDebug: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    originalDebug = process.env.CLUI_DEBUG
  })

  afterEach(() => {
    if (originalDebug !== undefined) {
      process.env.CLUI_DEBUG = originalDebug
    } else {
      delete process.env.CLUI_DEBUG
    }
  })

  describe('log levels', () => {
    it('exports LogLevel type with info and debug', async () => {
      const { LogLevel } = await import('../../src/main/logger')
      expect(LogLevel.INFO).toBe('info')
      expect(LogLevel.DEBUG).toBe('debug')
    })

    it('always logs info-level messages regardless of CLUI_DEBUG', async () => {
      delete process.env.CLUI_DEBUG
      const { log, flushLogs } = await import('../../src/main/logger')
      log('main', 'test info message', 'info')
      flushLogs()
      expect(mockAppendFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('test info message'),
      )
    })

    it('skips debug-level messages when CLUI_DEBUG is not set', async () => {
      delete process.env.CLUI_DEBUG
      const { log, flushLogs } = await import('../../src/main/logger')
      log('main', 'debug only message', 'debug')
      flushLogs()
      // Should not contain the debug message
      const allCalls = mockAppendFileSync.mock.calls
      const written = allCalls.map(c => String(c[1])).join('')
      expect(written).not.toContain('debug only message')
    })

    it('includes debug-level messages when CLUI_DEBUG=1', async () => {
      process.env.CLUI_DEBUG = '1'
      const { log, flushLogs } = await import('../../src/main/logger')
      log('main', 'debug message', 'debug')
      flushLogs()
      expect(mockAppendFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('debug message'),
      )
    })

    it('defaults to info level when level is omitted', async () => {
      delete process.env.CLUI_DEBUG
      const { log, flushLogs } = await import('../../src/main/logger')
      log('main', 'no level specified')
      flushLogs()
      expect(mockAppendFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('no level specified'),
      )
    })
  })

  describe('log rotation', () => {
    it('exports MAX_LOG_SIZE_BYTES constant (5 MB)', async () => {
      const { MAX_LOG_SIZE_BYTES } = await import('../../src/main/logger')
      expect(MAX_LOG_SIZE_BYTES).toBe(5 * 1024 * 1024)
    })

    it('exports MAX_LOG_FILES constant (3)', async () => {
      const { MAX_LOG_FILES } = await import('../../src/main/logger')
      expect(MAX_LOG_FILES).toBe(3)
    })

    it('rotates log files when current file exceeds MAX_LOG_SIZE_BYTES', async () => {
      // Simulate main log file being over 5MB
      mockExistsSync.mockReturnValue(true)
      mockStatSync.mockReturnValue({ size: 6 * 1024 * 1024 } as fs.Stats)

      const { rotateLogsIfNeeded, LOG_FILE } = await import('../../src/main/logger')
      rotateLogsIfNeeded()

      // Should rename .log.1 → .log.2, then .log → .log.1
      expect(mockRenameSync).toHaveBeenCalled()
    })

    it('deletes oldest log file beyond MAX_LOG_FILES', async () => {
      mockExistsSync.mockReturnValue(true)
      mockStatSync.mockReturnValue({ size: 6 * 1024 * 1024 } as fs.Stats)

      const { rotateLogsIfNeeded, LOG_FILE } = await import('../../src/main/logger')
      rotateLogsIfNeeded()

      // Should attempt to unlink the oldest file
      expect(mockUnlinkSync).toHaveBeenCalled()
    })

    it('does not rotate when log file is under MAX_LOG_SIZE_BYTES', async () => {
      mockExistsSync.mockReturnValue(true)
      mockStatSync.mockReturnValue({ size: 1024 } as fs.Stats)

      const { rotateLogsIfNeeded } = await import('../../src/main/logger')
      rotateLogsIfNeeded()

      expect(mockRenameSync).not.toHaveBeenCalled()
    })
  })

  describe('getLogFilePath', () => {
    it('returns the primary log file path', async () => {
      const { getLogFilePath } = await import('../../src/main/logger')
      const path = getLogFilePath()
      expect(path).toContain('.clui')
      expect(path).toContain('.log')
    })
  })
})
