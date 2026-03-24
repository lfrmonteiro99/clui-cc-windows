import { describe, it, expect, beforeEach } from 'vitest'
import { useModelRouterStore } from '../modelRouterStore'

describe('Effort routing', () => {
  beforeEach(() => {
    // Reset store to defaults
    useModelRouterStore.setState({
      enabled: true,
      mode: 'auto',
      overrides: {},
      effortOverrides: {},
      routingHistory: [],
    })
  })

  // ─── Complexity → Effort mapping ───

  describe('scoreToEffort mapping', () => {
    it('maps score 0-30 to low', () => {
      expect(useModelRouterStore.getState().scoreToEffort(0)).toBe('low')
      expect(useModelRouterStore.getState().scoreToEffort(15)).toBe('low')
      expect(useModelRouterStore.getState().scoreToEffort(30)).toBe('low')
    })

    it('maps score 31-65 to medium', () => {
      expect(useModelRouterStore.getState().scoreToEffort(31)).toBe('medium')
      expect(useModelRouterStore.getState().scoreToEffort(50)).toBe('medium')
      expect(useModelRouterStore.getState().scoreToEffort(65)).toBe('medium')
    })

    it('maps score 66-85 to high', () => {
      expect(useModelRouterStore.getState().scoreToEffort(66)).toBe('high')
      expect(useModelRouterStore.getState().scoreToEffort(75)).toBe('high')
      expect(useModelRouterStore.getState().scoreToEffort(85)).toBe('high')
    })

    it('maps score 86-100 to max', () => {
      expect(useModelRouterStore.getState().scoreToEffort(86)).toBe('max')
      expect(useModelRouterStore.getState().scoreToEffort(95)).toBe('max')
      expect(useModelRouterStore.getState().scoreToEffort(100)).toBe('max')
    })

    it('clamps out-of-range scores', () => {
      expect(useModelRouterStore.getState().scoreToEffort(-5)).toBe('low')
      expect(useModelRouterStore.getState().scoreToEffort(150)).toBe('max')
    })
  })

  // ─── Per-tab effort override ───

  describe('setEffort / getEffortForTab', () => {
    it('returns auto-resolved effort when no override', () => {
      // With no override and auto mode, getEffortForTab uses the last routing score
      useModelRouterStore.setState({
        routingHistory: [{ timestamp: Date.now(), tabId: 'tab-1', score: 50, model: 'sonnet' }],
      })
      const result = useModelRouterStore.getState().getEffortForTab('tab-1')
      expect(result).toEqual({ level: 'medium', source: 'auto' })
    })

    it('returns manual override when set', () => {
      useModelRouterStore.getState().setEffort('tab-1', 'max')
      const result = useModelRouterStore.getState().getEffortForTab('tab-1')
      expect(result).toEqual({ level: 'max', source: 'manual' })
    })

    it('returns default high when no routing history and no override', () => {
      const result = useModelRouterStore.getState().getEffortForTab('tab-unknown')
      expect(result).toEqual({ level: 'high', source: 'auto' })
    })

    it('clears override when set to null (reset to auto)', () => {
      useModelRouterStore.getState().setEffort('tab-1', 'low')
      expect(useModelRouterStore.getState().getEffortForTab('tab-1').source).toBe('manual')

      useModelRouterStore.getState().setEffort('tab-1', null)
      expect(useModelRouterStore.getState().getEffortForTab('tab-1').source).toBe('auto')
    })
  })

  // ─── Router disabled ───

  describe('when router is disabled', () => {
    it('returns default high effort', () => {
      useModelRouterStore.setState({ enabled: false })
      const result = useModelRouterStore.getState().getEffortForTab('tab-1')
      expect(result).toEqual({ level: 'high', source: 'auto' })
    })

    it('still respects manual override even when disabled', () => {
      useModelRouterStore.setState({ enabled: false })
      useModelRouterStore.getState().setEffort('tab-1', 'low')
      const result = useModelRouterStore.getState().getEffortForTab('tab-1')
      expect(result).toEqual({ level: 'low', source: 'manual' })
    })
  })
})
