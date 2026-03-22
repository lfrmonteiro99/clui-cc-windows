/**
 * TDD RED tests for project color presets and validation.
 */
import { describe, it, expect } from 'vitest'
import {
  PROJECT_COLOR_PRESETS,
  isValidProjectColor,
  getProjectAccentCSS,
} from '../../src/shared/project-colors'

describe('project-colors', () => {
  describe('PROJECT_COLOR_PRESETS', () => {
    it('provides at least 8 preset colors', () => {
      expect(PROJECT_COLOR_PRESETS.length).toBeGreaterThanOrEqual(8)
    })

    it('each preset has a name and hex value', () => {
      for (const preset of PROJECT_COLOR_PRESETS) {
        expect(preset.name).toBeTruthy()
        expect(preset.hex).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    })

    it('has unique color names', () => {
      const names = PROJECT_COLOR_PRESETS.map(p => p.name)
      expect(new Set(names).size).toBe(names.length)
    })

    it('has unique hex values', () => {
      const hexes = PROJECT_COLOR_PRESETS.map(p => p.hex)
      expect(new Set(hexes).size).toBe(hexes.length)
    })
  })

  describe('isValidProjectColor', () => {
    it('accepts valid 6-digit hex colors', () => {
      expect(isValidProjectColor('#ff5733')).toBe(true)
      expect(isValidProjectColor('#AABBCC')).toBe(true)
    })

    it('rejects invalid hex colors', () => {
      expect(isValidProjectColor('ff5733')).toBe(false)
      expect(isValidProjectColor('#fff')).toBe(false)
      expect(isValidProjectColor('#gggggg')).toBe(false)
      expect(isValidProjectColor('')).toBe(false)
    })
  })

  describe('getProjectAccentCSS', () => {
    it('returns CSS variable assignment string for a valid color', () => {
      const css = getProjectAccentCSS('#ff5733')
      expect(css).toBe('--clui-project-accent: #ff5733')
    })

    it('returns empty string for undefined color', () => {
      const css = getProjectAccentCSS(undefined)
      expect(css).toBe('')
    })
  })
})
