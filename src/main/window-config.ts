/**
 * Window configuration factory — returns platform-appropriate BrowserWindow options.
 *
 * Supports a fallback mode for Windows systems where transparency/click-through
 * causes compositor issues (GPU driver bugs, high-refresh-rate artifacts).
 */

export interface WindowConfigOptions {
  /** Use opaque fallback mode (disables transparency) */
  fallback?: boolean
}

export interface WindowConfig {
  type: 'panel' | undefined
  transparent: boolean
  alwaysOnTop: boolean
  skipTaskbar: boolean
  hasShadow: boolean
  backgroundColor: string
  iconFile: string
}

export type WidthMode = 'auto' | 'compact' | 'wide' | 'ultrawide'

/**
 * Calculate native window width based on screen size and user preference.
 */
export function calculateWindowWidth(screenWidth: number, mode: WidthMode): number {
  switch (mode) {
    case 'compact':
      return 1040
    case 'wide':
      return 1280
    case 'ultrawide':
      return 1600
    case 'auto':
    default:
      if (screenWidth > 1920) return 1600
      if (screenWidth > 1440) return 1280
      return 1040
  }
}

export function getWindowConfig(options: WindowConfigOptions = {}): WindowConfig {
  const isDarwin = process.platform === 'darwin'
  const isWin = process.platform === 'win32'
  const fallback = options.fallback ?? false

  return {
    type: isDarwin ? 'panel' : undefined,
    transparent: fallback ? false : true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: fallback ? '#1a1a2e' : '#00000000',
    iconFile: isWin ? 'icon.png' : 'icon.icns',
  }
}
