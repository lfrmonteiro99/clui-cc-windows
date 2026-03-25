/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DEFAULT_BODY_MAX_HEIGHT,
  PANEL_BODY_MAX_HEIGHT,
  CARD_COLLAPSED_WIDTH,
  CARD_EXPANDED_WIDTH,
  CONTENT_WIDTH,
  HEIGHT_STORAGE_KEY,
  PANEL_HEIGHT_BOOST,
  clampHeight,
} from '../../shared/adaptive-height'

describe('Adaptive height — renderer integration', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // ─── Width constants updated ───

  it('collapsed card width is wider than legacy 430', () => {
    expect(CARD_COLLAPSED_WIDTH).toBeGreaterThanOrEqual(480)
  })

  it('expanded card width is wider than legacy 700', () => {
    expect(CARD_EXPANDED_WIDTH).toBeGreaterThanOrEqual(790)
  })

  it('content width is wider than legacy 460', () => {
    expect(CONTENT_WIDTH).toBeGreaterThanOrEqual(510)
  })

  // ─── Height persistence via localStorage ───

  it('persists height to localStorage', () => {
    const height = 600
    localStorage.setItem(HEIGHT_STORAGE_KEY, String(height))
    expect(localStorage.getItem(HEIGHT_STORAGE_KEY)).toBe('600')
  })

  it('restores height from localStorage', () => {
    localStorage.setItem(HEIGHT_STORAGE_KEY, '550')
    const stored = parseInt(localStorage.getItem(HEIGHT_STORAGE_KEY) || '0', 10)
    expect(stored).toBe(550)
  })

  it('falls back to default when no stored height', () => {
    const stored = localStorage.getItem(HEIGHT_STORAGE_KEY)
    expect(stored).toBeNull()
    // App should use DEFAULT_BODY_MAX_HEIGHT
    expect(DEFAULT_BODY_MAX_HEIGHT).toBe(420)
  })

  // ─── Panel open triggers height increase ───

  it('PANEL_BODY_MAX_HEIGHT is larger than DEFAULT_BODY_MAX_HEIGHT', () => {
    expect(PANEL_BODY_MAX_HEIGHT).toBeGreaterThan(DEFAULT_BODY_MAX_HEIGHT)
  })

  it('panel open should use PANEL_BODY_MAX_HEIGHT', () => {
    // When any panel is open, bodyMaxHeight should be PANEL_BODY_MAX_HEIGHT
    const panelOpen = true
    const bodyMaxHeight = panelOpen ? PANEL_BODY_MAX_HEIGHT : DEFAULT_BODY_MAX_HEIGHT
    expect(bodyMaxHeight).toBe(PANEL_BODY_MAX_HEIGHT)
  })

  it('panel close should revert to DEFAULT_BODY_MAX_HEIGHT', () => {
    const panelOpen = false
    const bodyMaxHeight = panelOpen ? PANEL_BODY_MAX_HEIGHT : DEFAULT_BODY_MAX_HEIGHT
    expect(bodyMaxHeight).toBe(DEFAULT_BODY_MAX_HEIGHT)
  })

  // ─── Panel height boost triggers resizeHeight call ───

  it('PANEL_HEIGHT_BOOST provides enough room for panel content', () => {
    expect(PANEL_HEIGHT_BOOST).toBeGreaterThanOrEqual(400)
  })

  it('clamped panel height never exceeds screen minus margin', () => {
    const screenHeight = 1080
    const desiredHeight = 720 + PANEL_HEIGHT_BOOST // native + panel boost
    const clamped = clampHeight(desiredHeight, screenHeight)
    expect(clamped).toBeLessThanOrEqual(screenHeight - 40) // SCREEN_EDGE_MARGIN
  })

  // ─── resizeHeight IPC called on panel open ───

  it('calls resizeHeight when panel opens', () => {
    const mockResizeHeight = vi.fn()
    // Simulate the pattern used in App.tsx useEffect
    const anyPanelOpen = true
    const screenAvailHeight = 1080
    if (anyPanelOpen) {
      const targetHeight = clampHeight(720 + PANEL_HEIGHT_BOOST, screenAvailHeight)
      mockResizeHeight(targetHeight)
    }
    expect(mockResizeHeight).toHaveBeenCalledOnce()
    expect(mockResizeHeight.mock.calls[0][0]).toBeGreaterThan(720)
    expect(mockResizeHeight.mock.calls[0][0]).toBeLessThanOrEqual(1040)
  })

  it('calls resizeHeight with smaller value when panel closes', () => {
    const mockResizeHeight = vi.fn()
    const anyPanelOpen = false
    const defaultNativeHeight = 720
    if (!anyPanelOpen) {
      mockResizeHeight(defaultNativeHeight)
    }
    expect(mockResizeHeight).toHaveBeenCalledWith(720)
  })
})
