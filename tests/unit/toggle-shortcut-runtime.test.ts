/**
 * TDD RED tests for runtime shortcut update (change toggle shortcut from renderer).
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

describe('shortcut-config runtime update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe('validateShortcut', () => {
    it('accepts shortcuts with modifier + key', async () => {
      const { validateShortcut } = await import('../../src/main/shortcut-config')
      expect(validateShortcut('Ctrl+Space')).toBe(true)
      expect(validateShortcut('Alt+Shift+K')).toBe(true)
      expect(validateShortcut('CommandOrControl+E')).toBe(true)
    })

    it('rejects shortcuts without a modifier', async () => {
      const { validateShortcut } = await import('../../src/main/shortcut-config')
      expect(validateShortcut('Space')).toBe(false)
      expect(validateShortcut('K')).toBe(false)
    })

    it('rejects empty strings', async () => {
      const { validateShortcut } = await import('../../src/main/shortcut-config')
      expect(validateShortcut('')).toBe(false)
    })

    it('rejects modifier-only shortcuts', async () => {
      const { validateShortcut } = await import('../../src/main/shortcut-config')
      expect(validateShortcut('Ctrl')).toBe(false)
      expect(validateShortcut('Alt+Shift')).toBe(false)
    })
  })
})
