/**
 * CLUI Design Tokens — Dual theme (dark + light)
 * Colors derived from ChatCN oklch system and design-fixed.html reference.
 */
import { create } from 'zustand'

// ─── Color palettes ───

const darkColors = {
  // Container (glass surfaces)
  containerBg: '#242422',
  containerBgCollapsed: '#21211e',
  containerBorder: '#3b3b36',
  containerShadow: '0 8px 28px rgba(0, 0, 0, 0.35), 0 1px 6px rgba(0, 0, 0, 0.25)',
  cardShadow: '0 2px 8px rgba(0,0,0,0.35)',
  cardShadowCollapsed: '0 2px 6px rgba(0,0,0,0.4)',

  // Surface layers
  surfacePrimary: '#353530',
  surfaceSecondary: '#42423d',
  surfaceHover: 'rgba(255, 255, 255, 0.05)',
  surfaceActive: 'rgba(255, 255, 255, 0.08)',

  // Input
  inputBg: 'transparent',
  inputBorder: '#3b3b36',
  inputFocusBorder: 'rgba(217, 119, 87, 0.4)',
  inputPillBg: '#2a2a27',

  // Text
  textPrimary: '#ccc9c0',
  textSecondary: '#c0bdb2',
  textTertiary: '#76766e',
  textMuted: '#7a7a72',

  // Accent — orange
  accent: '#d97757',
  accentLight: 'rgba(217, 119, 87, 0.1)',
  accentSoft: 'rgba(217, 119, 87, 0.15)',

  // Status dots
  statusIdle: '#8a8a80',
  statusRunning: '#d97757',
  statusRunningBg: 'rgba(217, 119, 87, 0.1)',
  statusComplete: '#7aac8c',
  statusCompleteBg: 'rgba(122, 172, 140, 0.1)',
  statusError: '#c47060',
  statusErrorBg: 'rgba(196, 112, 96, 0.08)',
  statusDead: '#c47060',
  statusPermission: '#d97757',
  statusPermissionGlow: 'rgba(217, 119, 87, 0.4)',

  // Tab
  tabActive: '#353530',
  tabActiveBorder: '#4a4a45',
  tabInactive: 'transparent',
  tabHover: 'rgba(255, 255, 255, 0.05)',

  // User message bubble
  userBubble: '#353530',
  userBubbleBorder: '#4a4a45',
  userBubbleText: '#ccc9c0',

  // Assistant message
  messageBgAssistant: 'rgba(217, 119, 87, 0.08)',
  messageBgUser: 'rgba(255, 255, 255, 0.03)',
  messageAccentBorder: '#d97757',
  cardShadowMd: '0 2px 8px rgba(0,0,0,0.15)',
  accentGlow: '0 0 12px rgba(217,119,87,0.15)',

  // Tool card
  toolBg: '#353530',
  toolBorder: '#4a4a45',
  toolRunningBorder: 'rgba(217, 119, 87, 0.3)',
  toolRunningBg: 'rgba(217, 119, 87, 0.05)',

  // Timeline
  timelineLine: '#353530',
  timelineNode: 'rgba(217, 119, 87, 0.2)',
  timelineNodeActive: '#d97757',

  // Scrollbar
  scrollThumb: 'rgba(255, 255, 255, 0.15)',
  scrollThumbHover: 'rgba(255, 255, 255, 0.25)',

  // Stop button
  stopBg: '#ef4444',
  stopHover: '#dc2626',

  // Send button
  sendBg: '#d97757',
  sendHover: '#c96442',
  sendDisabled: 'rgba(217, 119, 87, 0.3)',

  // Popover
  popoverBg: '#292927',
  popoverBorder: '#3b3b36',
  popoverShadow: '0 4px 20px rgba(0,0,0,0.3), 0 1px 4px rgba(0,0,0,0.2)',

  // Code block
  codeBg: '#1a1a18',
  codeBlockBg: '#1a1a18',
  codeBlockText: '#b8b5aa',

  // Mic button
  micBg: '#353530',
  micColor: '#c0bdb2',
  micDisabled: '#42423d',

  // Placeholder
  placeholder: '#6b6b60',

  // Disabled button color
  btnDisabled: '#42423d',

  // Text on accent backgrounds
  textOnAccent: '#ffffff',

  // Button hover (CSS-only stack buttons)
  btnHoverColor: '#c0bdb2',
  btnHoverBg: '#302f2d',

  // Accent border variants (replaces hex-alpha concatenation antipattern)
  accentBorder: 'rgba(217, 119, 87, 0.19)',
  accentBorderMedium: 'rgba(217, 119, 87, 0.25)',

  // Permission card (amber)
  permissionBorder: 'rgba(245, 158, 11, 0.3)',
  permissionShadow: '0 2px 12px rgba(245, 158, 11, 0.08)',
  permissionHeaderBg: 'rgba(245, 158, 11, 0.06)',
  permissionHeaderBorder: 'rgba(245, 158, 11, 0.12)',

  // Permission allow (green)
  permissionAllowBg: 'rgba(34, 197, 94, 0.1)',
  permissionAllowHoverBg: 'rgba(34, 197, 94, 0.22)',
  permissionAllowBorder: 'rgba(34, 197, 94, 0.25)',

  // Permission deny (red)
  permissionDenyBg: 'rgba(239, 68, 68, 0.08)',
  permissionDenyHoverBg: 'rgba(239, 68, 68, 0.18)',
  permissionDenyBorder: 'rgba(239, 68, 68, 0.22)',

  // Permission denied card
  permissionDeniedBorder: 'rgba(196, 112, 96, 0.3)',
  permissionDeniedHeaderBorder: 'rgba(196, 112, 96, 0.12)',

  // Diff viewer
  diffAddedBg: 'rgba(34, 197, 94, 0.12)',
  diffAddedBorder: '#22c55e',
  diffRemovedBg: 'rgba(239, 68, 68, 0.12)',
  diffRemovedBorder: '#ef4444',
  diffHunkHeader: '#76766e',

  // Session freshness indicator
  freshnessActive: '#7aac8c',
  freshnessStale: '#d4a84b',
  freshnessNew: '#8a8a80',

  // Subtle border
  borderSubtle: '#3b3b36',

  // Accent primary (alias for accent)
  accentPrimary: '#d97757',

  // Surface tertiary
  surfaceTertiary: '#2a2a27',

  // Warning variants
  warningBg: 'rgba(212, 168, 75, 0.08)',
  warningBorder: 'rgba(212, 168, 75, 0.25)',
  warningText: '#d4a84b',

  // Accent opacity variants
  accentSolid: '#d97757',
  accentMuted: 'rgba(217, 119, 87, 0.2)',
  accentGhost: 'rgba(217, 119, 87, 0.05)',
} as const

const lightColors = {
  // Container (glass surfaces)
  containerBg: '#f9f8f5',
  containerBgCollapsed: '#f4f2ed',
  containerBorder: '#dddad2',
  containerShadow: '0 8px 28px rgba(0, 0, 0, 0.08), 0 1px 6px rgba(0, 0, 0, 0.04)',
  cardShadow: '0 2px 8px rgba(0,0,0,0.06)',
  cardShadowCollapsed: '0 2px 6px rgba(0,0,0,0.08)',

  // Surface layers
  surfacePrimary: '#edeae0',
  surfaceSecondary: '#dddad2',
  surfaceHover: 'rgba(0, 0, 0, 0.04)',
  surfaceActive: 'rgba(0, 0, 0, 0.06)',

  // Input
  inputBg: 'transparent',
  inputBorder: '#dddad2',
  inputFocusBorder: 'rgba(217, 119, 87, 0.4)',
  inputPillBg: '#ffffff',

  // Text
  textPrimary: '#3c3929',
  textSecondary: '#5a5749',
  textTertiary: '#8a8a80',
  textMuted: '#dddad2',

  // Accent — orange (darkened for text contrast on light bg)
  accent: '#c4613d',
  accentLight: 'rgba(217, 119, 87, 0.1)',
  accentSoft: 'rgba(217, 119, 87, 0.12)',

  // Status dots
  statusIdle: '#8a8a80',
  statusRunning: '#d97757',
  statusRunningBg: 'rgba(217, 119, 87, 0.1)',
  statusComplete: '#5a9e6f',
  statusCompleteBg: 'rgba(90, 158, 111, 0.1)',
  statusError: '#c47060',
  statusErrorBg: 'rgba(196, 112, 96, 0.06)',
  statusDead: '#c47060',
  statusPermission: '#d97757',
  statusPermissionGlow: 'rgba(217, 119, 87, 0.3)',

  // Tab
  tabActive: '#edeae0',
  tabActiveBorder: '#dddad2',
  tabInactive: 'transparent',
  tabHover: 'rgba(0, 0, 0, 0.04)',

  // User message bubble
  userBubble: '#edeae0',
  userBubbleBorder: '#dddad2',
  userBubbleText: '#3c3929',

  // Assistant message
  messageBgAssistant: 'rgba(217, 119, 87, 0.10)',
  messageBgUser: 'rgba(0, 0, 0, 0.03)',
  messageAccentBorder: '#d97757',
  cardShadowMd: '0 2px 8px rgba(0,0,0,0.08)',
  accentGlow: '0 0 12px rgba(217,119,87,0.15)',

  // Tool card
  toolBg: '#edeae0',
  toolBorder: '#dddad2',
  toolRunningBorder: 'rgba(217, 119, 87, 0.3)',
  toolRunningBg: 'rgba(217, 119, 87, 0.05)',

  // Timeline
  timelineLine: '#dddad2',
  timelineNode: 'rgba(217, 119, 87, 0.2)',
  timelineNodeActive: '#d97757',

  // Scrollbar
  scrollThumb: 'rgba(0, 0, 0, 0.1)',
  scrollThumbHover: 'rgba(0, 0, 0, 0.18)',

  // Stop button
  stopBg: '#ef4444',
  stopHover: '#dc2626',

  // Send button
  sendBg: '#d97757',
  sendHover: '#c96442',
  sendDisabled: 'rgba(217, 119, 87, 0.3)',

  // Popover
  popoverBg: '#f9f8f5',
  popoverBorder: '#dddad2',
  popoverShadow: '0 4px 20px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06)',

  // Code block
  codeBg: '#f0eee8',
  codeBlockBg: '#f0eee8',
  codeBlockText: '#3c3929',

  // Mic button
  micBg: '#edeae0',
  micColor: '#5a5749',
  micDisabled: '#c8c5bc',

  // Placeholder
  placeholder: '#b0ada4',

  // Disabled button color
  btnDisabled: '#c8c5bc',

  // Text on accent backgrounds
  textOnAccent: '#ffffff',

  // Button hover (CSS-only stack buttons)
  btnHoverColor: '#3c3929',
  btnHoverBg: '#edeae0',

  // Accent border variants (replaces hex-alpha concatenation antipattern)
  accentBorder: 'rgba(217, 119, 87, 0.19)',
  accentBorderMedium: 'rgba(217, 119, 87, 0.25)',

  // Permission card (amber)
  permissionBorder: 'rgba(245, 158, 11, 0.3)',
  permissionShadow: '0 2px 12px rgba(245, 158, 11, 0.08)',
  permissionHeaderBg: 'rgba(245, 158, 11, 0.06)',
  permissionHeaderBorder: 'rgba(245, 158, 11, 0.12)',

  // Permission allow (green)
  permissionAllowBg: 'rgba(34, 197, 94, 0.1)',
  permissionAllowHoverBg: 'rgba(34, 197, 94, 0.22)',
  permissionAllowBorder: 'rgba(34, 197, 94, 0.25)',

  // Permission deny (red)
  permissionDenyBg: 'rgba(239, 68, 68, 0.08)',
  permissionDenyHoverBg: 'rgba(239, 68, 68, 0.18)',
  permissionDenyBorder: 'rgba(239, 68, 68, 0.22)',

  // Permission denied card
  permissionDeniedBorder: 'rgba(196, 112, 96, 0.3)',
  permissionDeniedHeaderBorder: 'rgba(196, 112, 96, 0.12)',

  // Diff viewer
  diffAddedBg: 'rgba(34, 197, 94, 0.15)',
  diffAddedBorder: '#16a34a',
  diffRemovedBg: 'rgba(239, 68, 68, 0.15)',
  diffRemovedBorder: '#dc2626',
  diffHunkHeader: '#8a8a80',

  // Session freshness indicator
  freshnessActive: '#5a9e6f',
  freshnessStale: '#c49a3c',
  freshnessNew: '#8a8a80',

  // Subtle border
  borderSubtle: '#dddad2',

  // Accent primary (alias for accent)
  accentPrimary: '#d97757',

  // Surface tertiary
  surfaceTertiary: '#e4e1d8',

  // Warning variants
  warningBg: 'rgba(196, 154, 60, 0.08)',
  warningBorder: 'rgba(196, 154, 60, 0.25)',
  warningText: '#9a7a2e',

  // Accent opacity variants (must match light theme accent #c4613d)
  accentSolid: '#c4613d',
  accentMuted: 'rgba(196, 97, 61, 0.2)',
  accentGhost: 'rgba(196, 97, 61, 0.05)',
} as const

export type ColorPalette = { [K in keyof typeof darkColors]: string }

// ─── Accent presets ───

export const ACCENT_PRESETS = {
  orange: { dark: '#d97757', light: '#c4613d' },
  blue:   { dark: '#5b8dd9', light: '#3d6bc4' },
  teal:   { dark: '#57b9a5', light: '#3d9e8a' },
  purple: { dark: '#9b7dd4', light: '#7d5fb8' },
  rose:   { dark: '#d9577a', light: '#c43d5e' },
  green:  { dark: '#7aac6d', light: '#5e9451' },
} as const

export type AccentPresetName = keyof typeof ACCENT_PRESETS

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return { r: 217, g: 119, b: 87 } // fallback to orange
  return { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
}

export function deriveAccentTokens(baseHex: string, isDark: boolean): Partial<ColorPalette> {
  const { r, g, b } = hexToRgb(baseHex)
  return {
    accent: baseHex,
    accentLight: `rgba(${r}, ${g}, ${b}, ${isDark ? 0.1 : 0.1})`,
    accentSoft: `rgba(${r}, ${g}, ${b}, ${isDark ? 0.15 : 0.12})`,
    accentSolid: baseHex,
    accentMuted: `rgba(${r}, ${g}, ${b}, 0.2)`,
    accentGhost: `rgba(${r}, ${g}, ${b}, 0.05)`,
    accentPrimary: baseHex,
    accentBorder: `rgba(${r}, ${g}, ${b}, 0.19)`,
    accentBorderMedium: `rgba(${r}, ${g}, ${b}, 0.25)`,
    accentGlow: `0 0 12px rgba(${r}, ${g}, ${b}, 0.15)`,
    inputFocusBorder: `rgba(${r}, ${g}, ${b}, 0.4)`,
    statusRunning: baseHex,
    statusRunningBg: `rgba(${r}, ${g}, ${b}, 0.1)`,
    statusPermission: baseHex,
    statusPermissionGlow: `rgba(${r}, ${g}, ${b}, ${isDark ? 0.4 : 0.3})`,
    messageBgAssistant: `rgba(${r}, ${g}, ${b}, ${isDark ? 0.08 : 0.1})`,
    messageAccentBorder: baseHex,
    toolRunningBorder: `rgba(${r}, ${g}, ${b}, 0.3)`,
    toolRunningBg: `rgba(${r}, ${g}, ${b}, 0.05)`,
    timelineNode: `rgba(${r}, ${g}, ${b}, 0.2)`,
    timelineNodeActive: baseHex,
    sendBg: baseHex,
    sendHover: `rgba(${r}, ${g}, ${b}, 0.85)`,
    sendDisabled: `rgba(${r}, ${g}, ${b}, 0.3)`,
  }
}

// ─── Theme store ───

export type ThemeMode = 'system' | 'light' | 'dark'

interface ThemeState {
  isDark: boolean
  themeMode: ThemeMode
  soundEnabled: boolean
  expandedUI: boolean
  autoResumeEnabled: boolean
  autoResumeMaxRetries: number
  accentColor: AccentPresetName
  /** OS-reported dark mode — used when themeMode is 'system' */
  _systemIsDark: boolean
  setIsDark: (isDark: boolean) => void
  setThemeMode: (mode: ThemeMode) => void
  setSoundEnabled: (enabled: boolean) => void
  setExpandedUI: (expanded: boolean) => void
  setAutoResumeEnabled: (enabled: boolean) => void
  setAutoResumeMaxRetries: (retries: number) => void
  setAccentColor: (color: AccentPresetName) => void
  /** Called by OS theme change listener — updates system value */
  setSystemTheme: (isDark: boolean) => void
}

/** Convert camelCase token name to --clui-kebab-case CSS custom property */
function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

/** Sync all JS design tokens to CSS custom properties on :root */
function syncTokensToCss(tokens: ColorPalette): void {
  const style = document.documentElement.style
  for (const [key, value] of Object.entries(tokens)) {
    style.setProperty(`--clui-${camelToKebab(key)}`, value)
  }
}

function applyTheme(isDark: boolean, accentColor: AccentPresetName = 'orange'): void {
  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.classList.toggle('light', !isDark)
  const base = isDark ? darkColors : lightColors
  const preset = ACCENT_PRESETS[accentColor]
  const accentHex = isDark ? preset.dark : preset.light
  const overrides = deriveAccentTokens(accentHex, isDark)
  syncTokensToCss({ ...base, ...overrides } as ColorPalette)
}

const SETTINGS_KEY = 'clui-settings'

function isValidAccentPreset(v: unknown): v is AccentPresetName {
  return typeof v === 'string' && v in ACCENT_PRESETS
}

function loadSettings(): { themeMode: ThemeMode; soundEnabled: boolean; expandedUI: boolean; autoResumeEnabled: boolean; autoResumeMaxRetries: number; accentColor: AccentPresetName } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        themeMode: ['light', 'dark'].includes(parsed.themeMode) ? parsed.themeMode : 'dark',
        soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : true,
        expandedUI: typeof parsed.expandedUI === 'boolean' ? parsed.expandedUI : false,
        autoResumeEnabled: typeof parsed.autoResumeEnabled === 'boolean' ? parsed.autoResumeEnabled : true,
        autoResumeMaxRetries: typeof parsed.autoResumeMaxRetries === 'number' ? parsed.autoResumeMaxRetries : 3,
        accentColor: isValidAccentPreset(parsed.accentColor) ? parsed.accentColor : 'orange',
      }
    }
  } catch (err) {
    console.warn('[theme] loadSettings failed:', err)
  }
  return { themeMode: 'dark', soundEnabled: true, expandedUI: false, autoResumeEnabled: true, autoResumeMaxRetries: 3, accentColor: 'orange' }
}

function saveSettings(s: { themeMode: ThemeMode; soundEnabled: boolean; expandedUI: boolean; autoResumeEnabled: boolean; autoResumeMaxRetries: number; accentColor: AccentPresetName }): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch (err) { console.warn('[theme] saveSettings failed:', err) }
}

// Always start in compact UI mode on launch.
const saved = { ...loadSettings(), expandedUI: false }

/** Helper to collect current settings for saving */
function currentSettings(get: () => ThemeState): Parameters<typeof saveSettings>[0] {
  return {
    themeMode: get().themeMode,
    soundEnabled: get().soundEnabled,
    expandedUI: get().expandedUI,
    autoResumeEnabled: get().autoResumeEnabled,
    autoResumeMaxRetries: get().autoResumeMaxRetries,
    accentColor: get().accentColor,
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  isDark: saved.themeMode === 'dark' ? true : saved.themeMode === 'light' ? false : true,
  themeMode: saved.themeMode,
  soundEnabled: saved.soundEnabled,
  expandedUI: saved.expandedUI,
  autoResumeEnabled: saved.autoResumeEnabled,
  autoResumeMaxRetries: saved.autoResumeMaxRetries,
  accentColor: saved.accentColor,
  _systemIsDark: true,
  setIsDark: (isDark) => {
    set({ isDark })
    applyTheme(isDark, get().accentColor)
  },
  setThemeMode: (mode) => {
    const resolved = mode === 'system' ? get()._systemIsDark : mode === 'dark'
    set({ themeMode: mode, isDark: resolved })
    applyTheme(resolved, get().accentColor)
    saveSettings({ ...currentSettings(get), themeMode: mode })
  },
  setSoundEnabled: (enabled) => {
    set({ soundEnabled: enabled })
    saveSettings({ ...currentSettings(get), soundEnabled: enabled })
  },
  setExpandedUI: (expanded) => {
    set({ expandedUI: expanded })
    saveSettings({ ...currentSettings(get), expandedUI: expanded })
  },
  setAutoResumeEnabled: (enabled) => {
    set({ autoResumeEnabled: enabled })
    saveSettings({ ...currentSettings(get), autoResumeEnabled: enabled })
  },
  setAutoResumeMaxRetries: (retries) => {
    const next = Math.max(1, Math.floor(retries))
    set({ autoResumeMaxRetries: next })
    saveSettings({ ...currentSettings(get), autoResumeMaxRetries: next })
  },
  setAccentColor: (color) => {
    set({ accentColor: color })
    applyTheme(get().isDark, color)
    saveSettings({ ...currentSettings(get), accentColor: color })
  },
  setSystemTheme: (isDark) => {
    set({ _systemIsDark: isDark })
    // Only apply if following system
    if (get().themeMode === 'system') {
      set({ isDark })
      applyTheme(isDark, get().accentColor)
    }
  },
}))

// Initialize CSS vars with saved theme (including accent)
{
  const initIsDark = saved.themeMode !== 'light'
  applyTheme(initIsDark, saved.accentColor)
}

/** Build merged palette with accent overrides */
function getMergedPalette(isDark: boolean, accentColor: AccentPresetName): ColorPalette {
  const base = isDark ? darkColors : lightColors
  const preset = ACCENT_PRESETS[accentColor]
  const accentHex = isDark ? preset.dark : preset.light
  const overrides = deriveAccentTokens(accentHex, isDark)
  return { ...base, ...overrides } as ColorPalette
}

/** Reactive hook — returns the active color palette */
export function useColors(): ColorPalette {
  const isDark = useThemeStore((s) => s.isDark)
  const accentColor = useThemeStore((s) => s.accentColor)
  return getMergedPalette(isDark, accentColor)
}

/** Non-reactive getter — use outside React components */
export function getColors(isDark: boolean): ColorPalette {
  const accentColor = useThemeStore.getState().accentColor
  return getMergedPalette(isDark, accentColor)
}

// ─── Backward compatibility ───
// Legacy static export — components being migrated should use useColors() instead
export const colors = darkColors

// ─── Spacing ───

export const spacing = {
  contentWidth: 460,
  containerRadius: 20,
  containerPadding: 12,
  tabHeight: 32,
  inputMinHeight: 44,
  inputMaxHeight: 160,
  conversationMaxHeight: 380,
  pillRadius: 9999,
  circleSize: 36,
  circleGap: 8,
} as const

// ─── Animation ───

export const motion = {
  spring: { type: 'spring' as const, stiffness: 500, damping: 30 },
  easeOut: { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] as const },
  fadeIn: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
    transition: { duration: 0.15 },
  },
} as const
