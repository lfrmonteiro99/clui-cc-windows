/**
 * Theme export/import utilities for the renderer process.
 */
import { ThemeExport, validateThemeExport } from '../../shared/theme-schema'
import { useThemeStore } from '../theme'

const MAX_FILE_SIZE = 50 * 1024 // 50KB

export function exportTheme(): ThemeExport {
  const state = useThemeStore.getState()
  return {
    version: 1,
    name: 'My Theme',
    themeMode: state.themeMode === 'system' ? (state.isDark ? 'dark' : 'light') : state.themeMode,
  }
}

export function downloadTheme(theme: ThemeExport): void {
  const json = JSON.stringify(theme, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${theme.name.replace(/\s+/g, '-').toLowerCase()}.clui-theme.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importTheme(file: File): Promise<ThemeExport> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File too large (max 50KB)')
  }

  const text = await file.text()
  const json = JSON.parse(text)
  const result = validateThemeExport(json)

  if (!result.valid) {
    throw new Error(`Invalid theme: ${result.errors.join(', ')}`)
  }

  return json as ThemeExport
}

export function applyImportedTheme(theme: ThemeExport): void {
  const store = useThemeStore.getState()
  if (theme.themeMode) {
    store.setThemeMode(theme.themeMode)
  }
}
