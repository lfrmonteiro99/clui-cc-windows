// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { motion } from '../../src/renderer/theme'

describe('Animation timing system', () => {
  describe('motion.durations', () => {
    it('has all 5 duration presets with correct values', () => {
      expect(motion.durations.instant).toBe(0.1)
      expect(motion.durations.quick).toBe(0.15)
      expect(motion.durations.normal).toBe(0.2)
      expect(motion.durations.smooth).toBe(0.3)
      expect(motion.durations.slow).toBe(0.5)
    })
  })

  describe('motion.easings', () => {
    it('has easeOut, easeInOut, and snappy presets', () => {
      expect(motion.easings.easeOut).toEqual([0.25, 0.46, 0.45, 0.94])
      expect(motion.easings.easeInOut).toEqual([0.4, 0, 0.2, 1])
      expect(motion.easings.snappy).toEqual([0.34, 1.3, 0.64, 1])
    })
  })

  describe('motion.springs', () => {
    it('has snappy, bouncy, and gentle configs', () => {
      expect(motion.springs.snappy).toEqual({ type: 'spring', stiffness: 500, damping: 30 })
      expect(motion.springs.bouncy).toEqual({ type: 'spring', stiffness: 320, damping: 28 })
      expect(motion.springs.gentle).toEqual({ type: 'spring', stiffness: 200, damping: 25 })
    })
  })

  describe('motion.transitions', () => {
    it('has fadeUp with correct structure', () => {
      expect(motion.transitions.fadeUp).toEqual({
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -4 },
        transition: { duration: 0.15 },
      })
    })

    it('has fadeDown with correct structure', () => {
      expect(motion.transitions.fadeDown).toEqual({
        initial: { opacity: 0, y: -8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 8 },
        transition: { duration: 0.15 },
      })
    })

    it('has fadeScale with correct structure', () => {
      expect(motion.transitions.fadeScale).toEqual({
        initial: { opacity: 0, scale: 0.95 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.95 },
        transition: { duration: 0.15 },
      })
    })
  })

  describe('backward compatibility', () => {
    it('motion.spring still exists and matches springs.snappy', () => {
      expect(motion.spring).toEqual({ type: 'spring', stiffness: 500, damping: 30 })
      expect(motion.spring).toEqual(motion.springs.snappy)
    })

    it('motion.easeOut still exists with original values', () => {
      expect(motion.easeOut).toEqual({ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] })
    })

    it('motion.fadeIn still exists and matches transitions.fadeUp', () => {
      expect(motion.fadeIn).toEqual({
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -4 },
        transition: { duration: 0.15 },
      })
      expect(motion.fadeIn).toEqual(motion.transitions.fadeUp)
    })
  })
})
