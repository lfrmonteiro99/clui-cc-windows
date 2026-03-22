/**
 * TDD RED tests for dynamic window width calculation and opacity support.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mockPlatform } from '../helpers/mock-platform'

import {
  calculateWindowWidth,
  type WidthMode,
} from '../../src/main/window-config'

describe('calculateWindowWidth', () => {
  let restorePlatform: (() => void) | null = null

  afterEach(() => {
    restorePlatform?.()
    restorePlatform = null
  })

  describe('auto mode', () => {
    it('returns 1040 for screens <= 1440px', () => {
      expect(calculateWindowWidth(1440, 'auto')).toBe(1040)
    })

    it('returns 1280 for screens 1441–1920px', () => {
      expect(calculateWindowWidth(1920, 'auto')).toBe(1280)
    })

    it('returns 1600 for screens > 1920px', () => {
      expect(calculateWindowWidth(2560, 'auto')).toBe(1600)
    })

    it('returns 1040 for small screens', () => {
      expect(calculateWindowWidth(1024, 'auto')).toBe(1040)
    })
  })

  describe('fixed modes', () => {
    it('compact always returns 1040', () => {
      expect(calculateWindowWidth(2560, 'compact')).toBe(1040)
    })

    it('wide always returns 1280', () => {
      expect(calculateWindowWidth(1024, 'wide')).toBe(1280)
    })

    it('ultrawide always returns 1600', () => {
      expect(calculateWindowWidth(1024, 'ultrawide')).toBe(1600)
    })
  })

  describe('type safety', () => {
    it('defaults to auto for unknown mode', () => {
      expect(calculateWindowWidth(1920, 'unknown' as WidthMode)).toBe(1280)
    })
  })
})
