/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Import actual color palettes for token assertions
const darkColors = await import('../../theme').then((m) => m.getColors(true))
const lightColors = await import('../../theme').then((m) => m.getColors(false))

describe('UX-009: Warm color system + visual polish', () => {
  // --- 1. Accent color variants ---

  describe('Accent color variants in theme', () => {
    it('accentSolid exists and equals accent (dark)', () => {
      expect(darkColors).toHaveProperty('accentSolid')
      expect(darkColors.accentSolid).toBe(darkColors.accent)
    })

    it('accentSolid exists and equals accent (light)', () => {
      expect(lightColors).toHaveProperty('accentSolid')
      expect(lightColors.accentSolid).toBe(lightColors.accent)
    })

    it('accentMuted exists with ~20% opacity (dark)', () => {
      expect(darkColors).toHaveProperty('accentMuted')
      const match = darkColors.accentMuted.match(/rgba\(.+?,\s*([\d.]+)\s*\)/)
      expect(match).not.toBeNull()
      const alpha = parseFloat(match![1])
      expect(alpha).toBeGreaterThanOrEqual(0.15)
      expect(alpha).toBeLessThanOrEqual(0.25)
    })

    it('accentMuted exists with ~20% opacity (light)', () => {
      expect(lightColors).toHaveProperty('accentMuted')
      const match = lightColors.accentMuted.match(/rgba\(.+?,\s*([\d.]+)\s*\)/)
      expect(match).not.toBeNull()
      const alpha = parseFloat(match![1])
      expect(alpha).toBeGreaterThanOrEqual(0.15)
      expect(alpha).toBeLessThanOrEqual(0.25)
    })

    it('accentGhost exists with ~5% opacity (dark)', () => {
      expect(darkColors).toHaveProperty('accentGhost')
      const match = darkColors.accentGhost.match(/rgba\(.+?,\s*([\d.]+)\s*\)/)
      expect(match).not.toBeNull()
      const alpha = parseFloat(match![1])
      expect(alpha).toBeGreaterThanOrEqual(0.03)
      expect(alpha).toBeLessThanOrEqual(0.07)
    })

    it('accentGhost exists with ~5% opacity (light)', () => {
      expect(lightColors).toHaveProperty('accentGhost')
      const match = lightColors.accentGhost.match(/rgba\(.+?,\s*([\d.]+)\s*\)/)
      expect(match).not.toBeNull()
      const alpha = parseFloat(match![1])
      expect(alpha).toBeGreaterThanOrEqual(0.03)
      expect(alpha).toBeLessThanOrEqual(0.07)
    })

    it('new tokens do not break existing token count', () => {
      // Ensure both palettes have the same keys
      const darkKeys = Object.keys(darkColors).sort()
      const lightKeys = Object.keys(lightColors).sort()
      expect(darkKeys).toEqual(lightKeys)
    })
  })

  // --- 2. Scrollbar styles in CSS ---

  describe('Scrollbar styles in CSS', () => {
    const cssPath = path.resolve(__dirname, '../../index.css')
    const css = fs.readFileSync(cssPath, 'utf-8')

    it('conversation-scroll scrollbar styles exist', () => {
      expect(css).toContain('.conversation-scroll::-webkit-scrollbar')
      expect(css).toContain('.conversation-scroll::-webkit-scrollbar-thumb')
      expect(css).toContain('.conversation-scroll::-webkit-scrollbar-track')
    })

    it('conversation scrollbar width is 6px', () => {
      const match = css.match(/\.conversation-scroll::-webkit-scrollbar\s*\{[^}]*width:\s*(\d+)px/)
      expect(match).not.toBeNull()
      expect(match![1]).toBe('6')
    })

    it('code block horizontal scrollbar styles exist', () => {
      expect(css).toContain('.prose-cloud pre::-webkit-scrollbar')
    })
  })

  // --- 3. Conversation separator ---

  describe('Conversation-input visual separator', () => {
    const cssPath = path.resolve(__dirname, '../../index.css')
    const css = fs.readFileSync(cssPath, 'utf-8')

    it('conversation-separator class exists in CSS', () => {
      expect(css).toContain('.conversation-separator')
    })
  })

  // --- 4. Content width is responsive ---

  describe('Responsive content width', () => {
    it('assistant message max-width uses percentage not fixed class', () => {
      // Read the ConversationView source to verify the max-w class
      const cvPath = path.resolve(__dirname, '../ConversationView.tsx')
      const source = fs.readFileSync(cvPath, 'utf-8')
      // Should NOT contain max-w-3xl (fixed width cap)
      // The assistant message inner prose div should use a percentage-based max-width
      // We verify the prose div uses max-w-[92%] or similar percentage
      expect(source).toContain('max-w-[92%]')
    })
  })
})
