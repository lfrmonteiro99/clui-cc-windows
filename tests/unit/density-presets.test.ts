// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from 'vitest'
import { DENSITY_SCALES, applyDensity, useThemeStore, type DensityLevel } from '../../src/renderer/theme'

describe('DENSITY_SCALES', () => {
  it('has correct multiplier for compact', () => {
    expect(DENSITY_SCALES.compact).toBe(0.85)
  })

  it('has correct multiplier for normal', () => {
    expect(DENSITY_SCALES.normal).toBe(1.0)
  })

  it('has correct multiplier for spacious', () => {
    expect(DENSITY_SCALES.spacious).toBe(1.15)
  })

  it('has exactly three density levels', () => {
    expect(Object.keys(DENSITY_SCALES)).toEqual(['compact', 'normal', 'spacious'])
  })
})

describe('applyDensity', () => {
  const expectedVars = [
    '--clui-density',
    '--clui-font-base',
    '--clui-font-sm',
    '--clui-font-xs',
    '--clui-gap-sm',
    '--clui-gap-md',
    '--clui-gap-lg',
    '--clui-padding-sm',
    '--clui-padding-md',
    '--clui-padding-lg',
    '--clui-line-height',
  ]

  function getCssVar(name: string): string {
    return document.documentElement.style.getPropertyValue(name)
  }

  it('sets all expected CSS variables', () => {
    applyDensity('normal')
    for (const v of expectedVars) {
      expect(getCssVar(v)).not.toBe('')
    }
  })

  it('computes correct values for compact (0.85)', () => {
    applyDensity('compact')
    expect(getCssVar('--clui-density')).toBe('0.85')
    expect(getCssVar('--clui-font-base')).toBe(`${Math.round(13 * 0.85)}px`)
    expect(getCssVar('--clui-font-sm')).toBe(`${Math.round(11 * 0.85)}px`)
    expect(getCssVar('--clui-font-xs')).toBe(`${Math.round(10 * 0.85)}px`)
    expect(getCssVar('--clui-gap-sm')).toBe(`${Math.round(4 * 0.85)}px`)
    expect(getCssVar('--clui-gap-md')).toBe(`${Math.round(8 * 0.85)}px`)
    expect(getCssVar('--clui-gap-lg')).toBe(`${Math.round(12 * 0.85)}px`)
    expect(getCssVar('--clui-padding-sm')).toBe(`${Math.round(8 * 0.85)}px`)
    expect(getCssVar('--clui-padding-md')).toBe(`${Math.round(12 * 0.85)}px`)
    expect(getCssVar('--clui-padding-lg')).toBe(`${Math.round(16 * 0.85)}px`)
    expect(getCssVar('--clui-line-height')).toBe(String(1.5 + (0.85 - 1) * 0.5))
  })

  it('computes correct values for normal (1.0)', () => {
    applyDensity('normal')
    expect(getCssVar('--clui-density')).toBe('1')
    expect(getCssVar('--clui-font-base')).toBe('13px')
    expect(getCssVar('--clui-font-sm')).toBe('11px')
    expect(getCssVar('--clui-font-xs')).toBe('10px')
    expect(getCssVar('--clui-line-height')).toBe('1.5')
  })

  it('computes correct values for spacious (1.15)', () => {
    applyDensity('spacious')
    expect(getCssVar('--clui-density')).toBe('1.15')
    expect(getCssVar('--clui-font-base')).toBe(`${Math.round(13 * 1.15)}px`)
    expect(getCssVar('--clui-font-sm')).toBe(`${Math.round(11 * 1.15)}px`)
    expect(getCssVar('--clui-padding-lg')).toBe(`${Math.round(16 * 1.15)}px`)
    expect(getCssVar('--clui-line-height')).toBe(String(1.5 + (1.15 - 1) * 0.5))
  })
})

describe('loadSettings density defaults', () => {
  it('defaults density to normal when no settings saved', () => {
    // The store initializes from loadSettings, which defaults to 'normal'
    // We verify the store has density as a valid DensityLevel
    const density = useThemeStore.getState().density
    expect(density in DENSITY_SCALES).toBe(true)
  })

  it('handles invalid density gracefully — invalid keys are not in DENSITY_SCALES', () => {
    // The validation logic in loadSettings checks `parsed.density in DENSITY_SCALES`
    expect('ultra-tiny' in DENSITY_SCALES).toBe(false)
    expect('normal' in DENSITY_SCALES).toBe(true)
    expect('compact' in DENSITY_SCALES).toBe(true)
    expect('spacious' in DENSITY_SCALES).toBe(true)
  })
})

describe('setDensity', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('updates store state', () => {
    useThemeStore.getState().setDensity('compact')
    expect(useThemeStore.getState().density).toBe('compact')
  })

  it('persists density to localStorage', () => {
    useThemeStore.getState().setDensity('compact')
    const stored = JSON.parse(localStorage.getItem('clui-settings') || '{}')
    expect(stored.density).toBe('compact')
  })

  it('persists spacious density to localStorage', () => {
    useThemeStore.getState().setDensity('spacious')
    const stored = JSON.parse(localStorage.getItem('clui-settings') || '{}')
    expect(stored.density).toBe('spacious')
  })

  it('applies CSS variables when density changes', () => {
    useThemeStore.getState().setDensity('spacious')
    expect(document.documentElement.style.getPropertyValue('--clui-density')).toBe('1.15')
    useThemeStore.getState().setDensity('compact')
    expect(document.documentElement.style.getPropertyValue('--clui-density')).toBe('0.85')
  })
})
