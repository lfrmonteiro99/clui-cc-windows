import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mockPlatform } from '../helpers/mock-platform'
import { getDefaultShortcut, getSafeAlternatives, ShortcutConfig, loadShortcutConfig, saveShortcutConfig } from '../../src/main/shortcut-config'
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

describe('shortcut-config', () => {
  let restorePlatform: (() => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    restorePlatform?.()
    restorePlatform = null
  })

  describe('getDefaultShortcut', () => {
    it('returns Ctrl+Space on win32', () => {
      restorePlatform = mockPlatform('win32')
      expect(getDefaultShortcut()).toBe('CommandOrControl+Space')
    })

    it('returns Alt+Space on darwin', () => {
      restorePlatform = mockPlatform('darwin')
      expect(getDefaultShortcut()).toBe('Alt+Space')
    })
  })

  describe('getSafeAlternatives', () => {
    it('returns multiple alternatives', () => {
      const alts = getSafeAlternatives()
      expect(alts.length).toBeGreaterThanOrEqual(3)
    })

    it('does not include the default shortcut', () => {
      restorePlatform = mockPlatform('win32')
      const def = getDefaultShortcut()
      const alts = getSafeAlternatives()
      expect(alts).not.toContain(def)
    })
  })

  describe('loadShortcutConfig', () => {
    it('returns default when config file does not exist', () => {
      restorePlatform = mockPlatform('win32')
      mockExistsSync.mockReturnValue(false)

      const config = loadShortcutConfig()
      expect(config.primary).toBe('CommandOrControl+Space')
    })

    it('returns saved shortcut when config file exists', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ primary: 'Ctrl+Shift+Space' }))

      const config = loadShortcutConfig()
      expect(config.primary).toBe('Ctrl+Shift+Space')
    })

    it('falls back to default on corrupt config file', () => {
      restorePlatform = mockPlatform('win32')
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('not json!!!!')

      const config = loadShortcutConfig()
      expect(config.primary).toBe('CommandOrControl+Space')
    })
  })

  describe('saveShortcutConfig', () => {
    it('writes config to file', () => {
      const config: ShortcutConfig = { primary: 'Ctrl+Shift+Space' }
      saveShortcutConfig(config)

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify(config, null, 2) + '\n',
      )
    })
  })
})
