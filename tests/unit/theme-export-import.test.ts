import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateThemeExport, isValidColor, ThemeExport } from '../../src/shared/theme-schema'

// ─── isValidColor ───

describe('isValidColor', () => {
  it('accepts 6-digit hex colors', () => {
    expect(isValidColor('#ff0000')).toBe(true)
    expect(isValidColor('#AABBCC')).toBe(true)
    expect(isValidColor('#000000')).toBe(true)
  })

  it('accepts rgb() colors', () => {
    expect(isValidColor('rgb(255, 0, 0)')).toBe(true)
    expect(isValidColor('rgb(0,0,0)')).toBe(true)
  })

  it('accepts rgba() colors', () => {
    expect(isValidColor('rgba(255, 0, 0, 0.5)')).toBe(true)
    expect(isValidColor('rgba(0,0,0,1)')).toBe(true)
  })

  it('rejects invalid strings', () => {
    expect(isValidColor('red')).toBe(false)
    expect(isValidColor('#fff')).toBe(false)
    expect(isValidColor('notacolor')).toBe(false)
    expect(isValidColor('')).toBe(false)
    expect(isValidColor('hsl(0, 100%, 50%)')).toBe(false)
  })
})

// ─── validateThemeExport ───

describe('validateThemeExport', () => {
  const validTheme: ThemeExport = {
    version: 1,
    name: 'Test Theme',
    themeMode: 'dark',
  }

  it('accepts a valid theme', () => {
    const result = validateThemeExport(validTheme)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('accepts a valid theme with all optional fields', () => {
    const full: ThemeExport = {
      ...validTheme,
      accentColor: '#d97757',
      fontFamily: 'mono',
      density: 'compact',
      colorOverrides: {
        accent: '#ff0000',
        containerBg: 'rgba(0, 0, 0, 0.5)',
      },
    }
    const result = validateThemeExport(full)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects missing version', () => {
    const result = validateThemeExport({ name: 'X', themeMode: 'dark' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Invalid or missing version (must be 1)')
  })

  it('rejects wrong version', () => {
    const result = validateThemeExport({ version: 2, name: 'X', themeMode: 'dark' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Invalid or missing version (must be 1)')
  })

  it('rejects missing name', () => {
    const result = validateThemeExport({ version: 1, themeMode: 'dark' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing or invalid name')
  })

  it('rejects invalid themeMode', () => {
    const result = validateThemeExport({ version: 1, name: 'X', themeMode: 'blue' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Invalid themeMode (must be "light" or "dark")')
  })

  it('rejects invalid density', () => {
    const result = validateThemeExport({ version: 1, name: 'X', themeMode: 'dark', density: 'huge' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Invalid density value')
  })

  it('rejects invalid color format in overrides', () => {
    const result = validateThemeExport({
      version: 1,
      name: 'X',
      themeMode: 'dark',
      colorOverrides: { accent: 'not-a-color' },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e: string) => e.includes('Invalid color value for override "accent"'))).toBe(true)
  })

  it('rejects non-object colorOverrides', () => {
    const result = validateThemeExport({
      version: 1,
      name: 'X',
      themeMode: 'dark',
      colorOverrides: 'bad',
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('colorOverrides must be an object')
  })

  it('rejects null input', () => {
    const result = validateThemeExport(null)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Not a valid JSON object')
  })

  it('rejects non-object input', () => {
    const result = validateThemeExport('string')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Not a valid JSON object')
  })
})

// ─── exportTheme / importTheme ───

describe('exportTheme', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns correct structure', async () => {
    // Mock the theme store
    vi.doMock('../../src/renderer/theme', () => ({
      useThemeStore: {
        getState: () => ({
          themeMode: 'dark' as const,
          isDark: true,
        }),
      },
    }))

    const { exportTheme } = await import('../../src/renderer/utils/theme-io')
    const theme = exportTheme()

    expect(theme.version).toBe(1)
    expect(theme.name).toBe('My Theme')
    expect(theme.themeMode).toBe('dark')
  })

  it('resolves system theme to actual mode', async () => {
    vi.doMock('../../src/renderer/theme', () => ({
      useThemeStore: {
        getState: () => ({
          themeMode: 'system' as const,
          isDark: false,
        }),
      },
    }))

    const { exportTheme } = await import('../../src/renderer/utils/theme-io')
    const theme = exportTheme()

    expect(theme.themeMode).toBe('light')
  })
})

describe('importTheme', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('rejects files larger than 50KB', async () => {
    vi.doMock('../../src/renderer/theme', () => ({
      useThemeStore: {
        getState: () => ({
          themeMode: 'dark' as const,
          isDark: true,
        }),
      },
    }))

    const { importTheme } = await import('../../src/renderer/utils/theme-io')
    const bigFile = new File(['x'.repeat(51 * 1024)], 'big.json', { type: 'application/json' })

    await expect(importTheme(bigFile)).rejects.toThrow('File too large (max 50KB)')
  })

  it('rejects invalid JSON content', async () => {
    vi.doMock('../../src/renderer/theme', () => ({
      useThemeStore: {
        getState: () => ({
          themeMode: 'dark' as const,
          isDark: true,
        }),
      },
    }))

    const { importTheme } = await import('../../src/renderer/utils/theme-io')
    const badFile = new File(['not json'], 'bad.json', { type: 'application/json' })

    await expect(importTheme(badFile)).rejects.toThrow()
  })

  it('rejects invalid theme structure', async () => {
    vi.doMock('../../src/renderer/theme', () => ({
      useThemeStore: {
        getState: () => ({
          themeMode: 'dark' as const,
          isDark: true,
        }),
      },
    }))

    const { importTheme } = await import('../../src/renderer/utils/theme-io')
    const invalidTheme = JSON.stringify({ version: 2, name: 'Bad' })
    const file = new File([invalidTheme], 'bad.json', { type: 'application/json' })

    await expect(importTheme(file)).rejects.toThrow('Invalid theme')
  })

  it('accepts valid theme file', async () => {
    vi.doMock('../../src/renderer/theme', () => ({
      useThemeStore: {
        getState: () => ({
          themeMode: 'dark' as const,
          isDark: true,
        }),
      },
    }))

    const { importTheme } = await import('../../src/renderer/utils/theme-io')
    const validTheme = JSON.stringify({ version: 1, name: 'Nice', themeMode: 'light' })
    const file = new File([validTheme], 'nice.json', { type: 'application/json' })

    const result = await importTheme(file)
    expect(result.version).toBe(1)
    expect(result.name).toBe('Nice')
    expect(result.themeMode).toBe('light')
  })
})
