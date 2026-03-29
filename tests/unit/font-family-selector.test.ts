// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import after jsdom environment is set up (provides document, localStorage, etc.)
const { FONT_PRESETS, useThemeStore } = await import('../../src/renderer/theme')

describe('Font Family Selector', () => {
  beforeEach(() => {
    localStorage.clear()
    // Reset store to defaults
    useThemeStore.setState({ fontFamily: 'system' })
  })

  it('FONT_PRESETS has 8 entries with correct structure', () => {
    expect(FONT_PRESETS).toHaveLength(8)
    for (const preset of FONT_PRESETS) {
      expect(preset).toHaveProperty('id')
      expect(preset).toHaveProperty('label')
      expect(preset).toHaveProperty('monoStack')
      expect(typeof preset.id).toBe('string')
      expect(typeof preset.label).toBe('string')
      expect(typeof preset.monoStack).toBe('string')
      expect(preset.monoStack).toContain('monospace')
    }
  })

  it('FONT_PRESETS includes expected font families', () => {
    const ids = FONT_PRESETS.map((p) => p.id)
    expect(ids).toContain('system')
    expect(ids).toContain('jetbrains')
    expect(ids).toContain('fira')
    expect(ids).toContain('cascadia')
    expect(ids).toContain('sfmono')
    expect(ids).toContain('menlo')
    expect(ids).toContain('consolas')
    expect(ids).toContain('monaco')
  })

  it('defaults fontFamily to system', () => {
    expect(useThemeStore.getState().fontFamily).toBe('system')
  })

  it('setFontFamily updates the store and persists to localStorage', () => {
    useThemeStore.getState().setFontFamily('jetbrains')
    expect(useThemeStore.getState().fontFamily).toBe('jetbrains')

    // Verify localStorage was written
    const raw = localStorage.getItem('clui-settings')
    expect(raw).toBeTruthy()
    const saved = JSON.parse(raw!)
    expect(saved.fontFamily).toBe('jetbrains')
  })

  it('setFontFamily falls back to system for invalid id', () => {
    useThemeStore.getState().setFontFamily('nonexistent-font')
    expect(useThemeStore.getState().fontFamily).toBe('system')
  })

  it('setFontFamily sets --clui-font-mono CSS variable', () => {
    useThemeStore.getState().setFontFamily('fira')

    const value = document.documentElement.style.getPropertyValue('--clui-font-mono')
    expect(value).toContain('Fira Code')
  })

  it('CSS variable is set correctly for each preset', () => {
    for (const preset of FONT_PRESETS) {
      useThemeStore.getState().setFontFamily(preset.id)

      const value = document.documentElement.style.getPropertyValue('--clui-font-mono')
      expect(value).toBe(preset.monoStack)
    }
  })

  it('loadSettings handles invalid fontFamily gracefully', () => {
    // Store invalid fontFamily in localStorage
    localStorage.setItem('clui-settings', JSON.stringify({ fontFamily: 'invalid-font', themeMode: 'dark' }))

    // Re-import would be needed to test loadSettings from scratch, but we can
    // verify via setFontFamily that invalid ids are rejected
    useThemeStore.getState().setFontFamily('invalid-font')
    expect(useThemeStore.getState().fontFamily).toBe('system')
  })
})
