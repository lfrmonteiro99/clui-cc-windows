/**
 * TDD RED tests for window position/settings persistence (main process).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  }
})

const mockExistsSync = vi.mocked(fs.existsSync)
const mockReadFileSync = vi.mocked(fs.readFileSync)
const mockWriteFileSync = vi.mocked(fs.writeFileSync)

describe('window-persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loadWindowPosition', () => {
    it('returns null when no saved position exists', async () => {
      mockExistsSync.mockReturnValue(false)
      const { loadWindowPosition } = await import('../../src/main/window-persistence')
      expect(loadWindowPosition()).toBeNull()
    })

    it('returns saved bounds when config file exists', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        position: { x: 100, y: 200, width: 1040, height: 720 },
      }))
      const { loadWindowPosition } = await import('../../src/main/window-persistence')
      const pos = loadWindowPosition()
      expect(pos).toEqual({ x: 100, y: 200, width: 1040, height: 720 })
    })

    it('returns null for corrupt config', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('BAD JSON')
      const { loadWindowPosition } = await import('../../src/main/window-persistence')
      expect(loadWindowPosition()).toBeNull()
    })
  })

  describe('saveWindowPosition', () => {
    it('writes bounds to config file', async () => {
      const { saveWindowPosition } = await import('../../src/main/window-persistence')
      saveWindowPosition({ x: 50, y: 100, width: 1280, height: 720 })
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('clui-window.json'),
        expect.stringContaining('"x":50'),
      )
    })
  })

  describe('loadWindowSettings', () => {
    it('returns default opacity when no config exists', async () => {
      mockExistsSync.mockReturnValue(false)
      const { loadWindowSettings } = await import('../../src/main/window-persistence')
      const settings = loadWindowSettings()
      expect(settings.opacity).toBe(1.0)
    })

    it('returns saved opacity', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ opacity: 0.7, widthMode: 'wide' }))
      const { loadWindowSettings } = await import('../../src/main/window-persistence')
      const settings = loadWindowSettings()
      expect(settings.opacity).toBe(0.7)
      expect(settings.widthMode).toBe('wide')
    })
  })

  describe('saveWindowSettings', () => {
    it('persists opacity and widthMode', async () => {
      const { saveWindowSettings } = await import('../../src/main/window-persistence')
      saveWindowSettings({ opacity: 0.5, widthMode: 'ultrawide' })
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('clui-window.json'),
        expect.stringContaining('"opacity":0.5'),
      )
    })
  })
})
