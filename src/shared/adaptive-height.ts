// ─── Adaptive Height Constants ───
// Shared between main process (BrowserWindow sizing) and renderer (layout).

/** Minimum window height in pixels */
export const MIN_WINDOW_HEIGHT = 300

/** Margin from screen edges (taskbar, etc.) */
export const SCREEN_EDGE_MARGIN = 40

/** Default body max-height when no panel is open */
export const DEFAULT_BODY_MAX_HEIGHT = 420

/** Body max-height when panels are open (expanded, terminal, comparison) */
export const PANEL_BODY_MAX_HEIGHT = 560

/** localStorage key for persisted window height */
export const HEIGHT_STORAGE_KEY = 'clui-window-height'

/** Default collapsed card width */
export const CARD_COLLAPSED_WIDTH = 490

/** Default expanded card width */
export const CARD_EXPANDED_WIDTH = 800

/** Default content column width (replaces spacing.contentWidth for adaptive layout) */
export const CONTENT_WIDTH = 520

/** Height added when a panel (marketplace, context, etc.) is open */
export const PANEL_HEIGHT_BOOST = 500

/**
 * Calculates the maximum window height based on available screen height.
 * Returns screenAvailHeight - SCREEN_EDGE_MARGIN, clamped to at least MIN_WINDOW_HEIGHT.
 */
export function calcMaxHeight(screenAvailHeight: number): number {
  return Math.max(MIN_WINDOW_HEIGHT, screenAvailHeight - SCREEN_EDGE_MARGIN)
}

/**
 * Clamps a height value between min and max window heights.
 */
export function clampHeight(height: number, screenAvailHeight: number): number {
  const max = calcMaxHeight(screenAvailHeight)
  return Math.max(MIN_WINDOW_HEIGHT, Math.min(height, max))
}
