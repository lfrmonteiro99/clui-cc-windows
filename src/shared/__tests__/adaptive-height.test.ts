import { describe, it, expect } from 'vitest'
import {
  MIN_WINDOW_HEIGHT,
  SCREEN_EDGE_MARGIN,
  DEFAULT_BODY_MAX_HEIGHT,
  PANEL_BODY_MAX_HEIGHT,
  HEIGHT_STORAGE_KEY,
  CARD_COLLAPSED_WIDTH,
  CARD_EXPANDED_WIDTH,
  CONTENT_WIDTH,
  calcMaxHeight,
  clampHeight,
} from '../adaptive-height'

describe('Adaptive height constants', () => {
  it('enforces minimum height of 300px', () => {
    expect(MIN_WINDOW_HEIGHT).toBe(300)
  })

  it('uses screen edge margin of 40px', () => {
    expect(SCREEN_EDGE_MARGIN).toBe(40)
  })

  it('sets default body max height to 420', () => {
    expect(DEFAULT_BODY_MAX_HEIGHT).toBe(420)
  })

  it('sets panel body max height to 560', () => {
    expect(PANEL_BODY_MAX_HEIGHT).toBe(560)
  })

  it('has correct localStorage key for height persistence', () => {
    expect(HEIGHT_STORAGE_KEY).toBe('clui-window-height')
  })

  it('increased collapsed card width (~60px increase from 430)', () => {
    expect(CARD_COLLAPSED_WIDTH).toBe(490)
    expect(CARD_COLLAPSED_WIDTH).toBeGreaterThan(430)
  })

  it('increased expanded card width (~100px increase from 700)', () => {
    expect(CARD_EXPANDED_WIDTH).toBe(800)
    expect(CARD_EXPANDED_WIDTH).toBeGreaterThan(700)
  })

  it('increased content column width (~60px increase from 460)', () => {
    expect(CONTENT_WIDTH).toBe(520)
    expect(CONTENT_WIDTH).toBeGreaterThan(460)
  })
})

describe('calcMaxHeight', () => {
  it('returns screen height minus margin for typical screen', () => {
    expect(calcMaxHeight(1080)).toBe(1080 - SCREEN_EDGE_MARGIN)
  })

  it('returns screen height minus margin for 4K display', () => {
    expect(calcMaxHeight(2160)).toBe(2160 - SCREEN_EDGE_MARGIN)
  })

  it('never returns less than MIN_WINDOW_HEIGHT', () => {
    // Extreme case: very small screen
    expect(calcMaxHeight(200)).toBe(MIN_WINDOW_HEIGHT)
    expect(calcMaxHeight(0)).toBe(MIN_WINDOW_HEIGHT)
  })

  it('returns MIN_WINDOW_HEIGHT when screen is exactly MIN_WINDOW_HEIGHT + margin', () => {
    expect(calcMaxHeight(MIN_WINDOW_HEIGHT + SCREEN_EDGE_MARGIN)).toBe(MIN_WINDOW_HEIGHT)
  })
})

describe('clampHeight', () => {
  const SCREEN = 1080

  it('clamps below MIN_WINDOW_HEIGHT to MIN_WINDOW_HEIGHT', () => {
    expect(clampHeight(100, SCREEN)).toBe(MIN_WINDOW_HEIGHT)
    expect(clampHeight(0, SCREEN)).toBe(MIN_WINDOW_HEIGHT)
    expect(clampHeight(-50, SCREEN)).toBe(MIN_WINDOW_HEIGHT)
  })

  it('clamps above max to max', () => {
    const max = calcMaxHeight(SCREEN)
    expect(clampHeight(2000, SCREEN)).toBe(max)
    expect(clampHeight(max + 1, SCREEN)).toBe(max)
  })

  it('passes through values within range', () => {
    expect(clampHeight(500, SCREEN)).toBe(500)
    expect(clampHeight(MIN_WINDOW_HEIGHT, SCREEN)).toBe(MIN_WINDOW_HEIGHT)
  })

  it('clamps to exact max', () => {
    const max = calcMaxHeight(SCREEN)
    expect(clampHeight(max, SCREEN)).toBe(max)
  })
})
