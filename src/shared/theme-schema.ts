/**
 * Theme export/import schema and validation.
 * Shared between renderer (theme-io.ts) and tests.
 */

export interface ThemeExport {
  version: 1
  name: string
  themeMode: 'light' | 'dark'
  accentColor?: string
  fontFamily?: string
  density?: 'compact' | 'normal' | 'spacious'
  colorOverrides?: Record<string, string>
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/
const RGBA_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/

export function isValidColor(value: string): boolean {
  return HEX_RE.test(value) || RGBA_RE.test(value)
}

export function validateThemeExport(json: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!json || typeof json !== 'object') {
    return { valid: false, errors: ['Not a valid JSON object'] }
  }

  const obj = json as Record<string, unknown>

  if (obj.version !== 1) errors.push('Invalid or missing version (must be 1)')
  if (typeof obj.name !== 'string' || !obj.name) errors.push('Missing or invalid name')
  if (!['light', 'dark'].includes(obj.themeMode as string)) errors.push('Invalid themeMode (must be "light" or "dark")')

  if (obj.density !== undefined && !['compact', 'normal', 'spacious'].includes(obj.density as string)) {
    errors.push('Invalid density value')
  }

  if (obj.colorOverrides !== undefined) {
    if (typeof obj.colorOverrides !== 'object' || obj.colorOverrides === null) {
      errors.push('colorOverrides must be an object')
    } else {
      for (const [key, val] of Object.entries(obj.colorOverrides as Record<string, unknown>)) {
        if (typeof val !== 'string' || !isValidColor(val)) {
          errors.push(`Invalid color value for override "${key}"`)
        }
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
