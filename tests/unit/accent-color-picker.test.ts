import { beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length(): number { return this.map.size }
  clear(): void { this.map.clear() }
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null }
  key(index: number): string | null { return Array.from(this.map.keys())[index] ?? null }
  removeItem(key: string): void { this.map.delete(key) }
  setItem(key: string, value: string): void { this.map.set(key, value) }
}

import { ACCENT_PRESETS, deriveAccentTokens, hexToRgb } from '../../src/renderer/theme'

describe('hexToRgb', () => {
  it('parses a standard 6-digit hex color', () => {
    expect(hexToRgb('#d97757')).toEqual({ r: 217, g: 119, b: 87 })
  })

  it('parses hex without leading #', () => {
    expect(hexToRgb('5b8dd9')).toEqual({ r: 91, g: 141, b: 217 })
  })

  it('returns fallback orange for invalid input', () => {
    expect(hexToRgb('not-a-color')).toEqual({ r: 217, g: 119, b: 87 })
  })
})

describe('deriveAccentTokens', () => {
  const requiredKeys = [
    'accent', 'accentLight', 'accentSoft', 'accentSolid', 'accentMuted',
    'accentGhost', 'accentPrimary', 'accentBorder', 'accentBorderMedium',
    'accentGlow', 'inputFocusBorder', 'statusRunning', 'statusRunningBg',
    'statusPermission', 'statusPermissionGlow', 'messageBgAssistant',
    'messageAccentBorder', 'toolRunningBorder', 'toolRunningBg',
    'timelineNode', 'timelineNodeActive', 'sendBg', 'sendHover', 'sendDisabled',
  ]

  it('returns object with all required accent-derived keys', () => {
    const tokens = deriveAccentTokens('#d97757', true)
    for (const key of requiredKeys) {
      expect(tokens).toHaveProperty(key)
    }
  })

  it('uses the base hex for solid accent tokens', () => {
    const tokens = deriveAccentTokens('#5b8dd9', true)
    expect(tokens.accent).toBe('#5b8dd9')
    expect(tokens.accentSolid).toBe('#5b8dd9')
    expect(tokens.accentPrimary).toBe('#5b8dd9')
    expect(tokens.sendBg).toBe('#5b8dd9')
    expect(tokens.statusRunning).toBe('#5b8dd9')
    expect(tokens.timelineNodeActive).toBe('#5b8dd9')
  })

  it('produces valid rgba strings for transparent tokens', () => {
    const tokens = deriveAccentTokens('#57b9a5', false)
    const rgbaPattern = /^rgba\(\d+, \d+, \d+, [\d.]+\)$/
    expect(tokens.accentLight).toMatch(rgbaPattern)
    expect(tokens.accentSoft).toMatch(rgbaPattern)
    expect(tokens.accentMuted).toMatch(rgbaPattern)
    expect(tokens.accentGhost).toMatch(rgbaPattern)
    expect(tokens.sendHover).toMatch(rgbaPattern)
    expect(tokens.sendDisabled).toMatch(rgbaPattern)
    expect(tokens.toolRunningBorder).toMatch(rgbaPattern)
    expect(tokens.toolRunningBg).toMatch(rgbaPattern)
  })

  it('produces valid box-shadow for accentGlow', () => {
    const tokens = deriveAccentTokens('#9b7dd4', true)
    expect(tokens.accentGlow).toMatch(/^0 0 12px rgba\(\d+, \d+, \d+, [\d.]+\)$/)
  })

  it('each preset produces valid tokens for dark mode', () => {
    for (const [, preset] of Object.entries(ACCENT_PRESETS)) {
      const tokens = deriveAccentTokens(preset.dark, true)
      expect(tokens.accent).toBe(preset.dark)
      expect(typeof tokens.accentLight).toBe('string')
      const rgb = hexToRgb(preset.dark)
      expect(tokens.accentLight).toContain(`${rgb.r}`)
    }
  })

  it('each preset produces valid tokens for light mode', () => {
    for (const [, preset] of Object.entries(ACCENT_PRESETS)) {
      const tokens = deriveAccentTokens(preset.light, false)
      expect(tokens.accent).toBe(preset.light)
    }
  })
})

describe('ACCENT_PRESETS', () => {
  it('has exactly 6 presets', () => {
    expect(Object.keys(ACCENT_PRESETS)).toHaveLength(6)
  })

  it('each preset has dark and light hex colors', () => {
    const hexPattern = /^#[0-9a-f]{6}$/i
    for (const preset of Object.values(ACCENT_PRESETS)) {
      expect(preset.dark).toMatch(hexPattern)
      expect(preset.light).toMatch(hexPattern)
    }
  })

  it('includes orange as the default preset', () => {
    expect(ACCENT_PRESETS).toHaveProperty('orange')
  })
})

describe('accent color settings persistence', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    vi.resetModules()
  })

  it('defaults to orange when no saved value', async () => {
    const { useThemeStore } = await import('../../src/renderer/theme')
    expect(useThemeStore.getState().accentColor).toBe('orange')
  })

  it('handles invalid accent value gracefully', async () => {
    storage.setItem('clui-settings', JSON.stringify({
      themeMode: 'dark',
      soundEnabled: true,
      expandedUI: false,
      autoResumeEnabled: true,
      autoResumeMaxRetries: 3,
      accentColor: 'invalid-color',
    }))
    const { useThemeStore } = await import('../../src/renderer/theme')
    expect(useThemeStore.getState().accentColor).toBe('orange')
  })

  it('setAccentColor persists to localStorage', async () => {
    const { useThemeStore } = await import('../../src/renderer/theme')
    useThemeStore.getState().setAccentColor('blue')
    const raw = storage.getItem('clui-settings')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.accentColor).toBe('blue')
  })

  it('setAccentColor updates store state', async () => {
    const { useThemeStore } = await import('../../src/renderer/theme')
    useThemeStore.getState().setAccentColor('purple')
    expect(useThemeStore.getState().accentColor).toBe('purple')
  })
})
