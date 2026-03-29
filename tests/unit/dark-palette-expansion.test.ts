/**
 * Tests for expanded dark theme palette with intermediate gray tones (#302).
 *
 * Validates that new surface tokens exist in both palettes, are ordered by
 * luminance in the dark theme, and generate correct CSS variable names.
 */
import { describe, it, expect } from 'vitest'

// We import the non-reactive getter and the palette objects via the module.
// The module calls `document.documentElement.style.setProperty` on load,
// so we need jsdom (already configured in vitest config).
const themeModule = await import('../../src/renderer/theme')
const { getColors } = themeModule

const NEW_TOKENS = [
  'surfaceElevated',
  'surfaceDepressed',
  'surfaceOverlay',
  'surfaceCard',
] as const

describe('dark palette expansion (#302)', () => {
  it('new tokens exist in darkColors', () => {
    const dark = getColors(true)
    for (const token of NEW_TOKENS) {
      expect(dark[token], `darkColors.${token} should be defined`).toBeDefined()
      expect(typeof dark[token]).toBe('string')
      expect(dark[token].length).toBeGreaterThan(0)
    }
  })

  it('new tokens exist in lightColors', () => {
    const light = getColors(false)
    for (const token of NEW_TOKENS) {
      expect(light[token], `lightColors.${token} should be defined`).toBeDefined()
      expect(typeof light[token]).toBe('string')
      expect(light[token].length).toBeGreaterThan(0)
    }
  })

  it('dark tokens are ordered by luminance (depressed < containerBg < card < primary < elevated < secondary < overlay)', () => {
    const dark = getColors(true)

    /** Parse a hex color like #rrggbb to approximate relative luminance */
    function hexLuminance(hex: string): number {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    // Expected ordering from darkest to lightest
    const orderedTokens = [
      dark.surfaceDepressed,  // #1e1e1c
      dark.containerBg,       // #242422
      dark.surfaceCard,       // #2e2e2b
      dark.surfacePrimary,    // #353530
      dark.surfaceElevated,   // #3d3d38
      dark.surfaceSecondary,  // #42423d
      dark.surfaceOverlay,    // #484843
    ]

    for (let i = 0; i < orderedTokens.length - 1; i++) {
      const lumA = hexLuminance(orderedTokens[i])
      const lumB = hexLuminance(orderedTokens[i + 1])
      expect(lumA, `${orderedTokens[i]} should be darker than ${orderedTokens[i + 1]}`).toBeLessThan(lumB)
    }
  })

  it('syncTokensToCss generates correct CSS variable names for new tokens', () => {
    // camelToKebab is not exported, but we can verify the CSS vars are set
    // by checking document.documentElement.style after applying theme
    const dark = getColors(true)

    // Apply dark theme to trigger syncTokensToCss
    const style = document.documentElement.style

    // The module calls syncTokensToCss on load, but we need to verify the
    // new tokens specifically. Re-trigger by calling the store action.
    const { useThemeStore } = themeModule
    useThemeStore.getState().setIsDark(true)

    expect(style.getPropertyValue('--clui-surface-elevated')).toBe(dark.surfaceElevated)
    expect(style.getPropertyValue('--clui-surface-depressed')).toBe(dark.surfaceDepressed)
    expect(style.getPropertyValue('--clui-surface-overlay')).toBe(dark.surfaceOverlay)
    expect(style.getPropertyValue('--clui-surface-card')).toBe(dark.surfaceCard)
  })
})
