import { describe, it, expect } from 'vitest'
import { TERMINAL_SCHEMES, type TerminalColorScheme } from '../../src/renderer/utils/terminal-schemes'

const REQUIRED_COLOR_KEYS: (keyof TerminalColorScheme['colors'])[] = [
  'black', 'red', 'green', 'yellow',
  'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
  'foreground', 'background', 'cursor', 'selectionBackground',
]

describe('TERMINAL_SCHEMES', () => {
  it('has exactly 8 schemes', () => {
    expect(TERMINAL_SCHEMES).toHaveLength(8)
  })

  it('includes a Default scheme', () => {
    const defaultScheme = TERMINAL_SCHEMES.find((s) => s.name === 'Default')
    expect(defaultScheme).toBeDefined()
  })

  it('has unique scheme names', () => {
    const names = TERMINAL_SCHEMES.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  for (const scheme of TERMINAL_SCHEMES) {
    describe(`scheme: ${scheme.name}`, () => {
      it('has all required color keys', () => {
        for (const key of REQUIRED_COLOR_KEYS) {
          expect(scheme.colors).toHaveProperty(key)
          expect(typeof scheme.colors[key]).toBe('string')
        }
      })

      it('has valid hex color values for ANSI colors', () => {
        const hexPattern = /^#[0-9a-fA-F]{6}$/
        const ansiKeys = REQUIRED_COLOR_KEYS.filter((k) => k !== 'selectionBackground')
        for (const key of ansiKeys) {
          expect(scheme.colors[key]).toMatch(hexPattern)
        }
      })
    })
  }
})
