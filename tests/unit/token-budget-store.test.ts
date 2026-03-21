import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Test Constants ───
const DEFAULT_MAX_TOKENS = 200_000
const WARN_THRESHOLD = 0.7
const CRITICAL_THRESHOLD = 0.85

// Must define window/localStorage before importing the store
vi.hoisted(() => {
  if (!globalThis.crypto) {
    ;(globalThis as Record<string, unknown>).crypto = { randomUUID: () => '00000000-0000-0000-0000-000000000000' }
  }
  ;(globalThis as Record<string, unknown>).window = {
    ...((globalThis as Record<string, unknown>).window || {}),
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  }
})

import { useTokenBudgetStore, type TokenBudget, type TokenCategory } from '../../src/renderer/stores/tokenBudgetStore'

describe('tokenBudgetStore', () => {
  beforeEach(() => {
    useTokenBudgetStore.setState({
      budgets: {},
      maxContextTokens: DEFAULT_MAX_TOKENS,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── Initial State ───

  describe('initial state', () => {
    it('starts with empty budgets map', () => {
      const state = useTokenBudgetStore.getState()
      expect(state.budgets).toEqual({})
    })

    it('has a default max context token limit', () => {
      const state = useTokenBudgetStore.getState()
      expect(state.maxContextTokens).toBe(DEFAULT_MAX_TOKENS)
    })
  })

  // ─── Recording Usage ───

  describe('recordUsage', () => {
    it('creates a new budget entry for a tab', () => {
      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 100,
      })

      const budget = useTokenBudgetStore.getState().budgets['tab-1']
      expect(budget).toBeDefined()
      expect(budget.inputTokens).toBe(1000)
      expect(budget.outputTokens).toBe(500)
      expect(budget.cacheReadTokens).toBe(200)
      expect(budget.cacheCreationTokens).toBe(100)
    })

    it('accumulates tokens across multiple recordings', () => {
      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', { input_tokens: 1000, output_tokens: 500 })
      recordUsage('tab-1', { input_tokens: 2000, output_tokens: 300 })

      const budget = useTokenBudgetStore.getState().budgets['tab-1']
      expect(budget.inputTokens).toBe(3000)
      expect(budget.outputTokens).toBe(800)
    })

    it('handles missing fields gracefully (defaults to 0)', () => {
      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', {})

      const budget = useTokenBudgetStore.getState().budgets['tab-1']
      expect(budget.inputTokens).toBe(0)
      expect(budget.outputTokens).toBe(0)
      expect(budget.cacheReadTokens).toBe(0)
      expect(budget.cacheCreationTokens).toBe(0)
    })

    it('tracks separate budgets per tab', () => {
      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', { input_tokens: 1000 })
      recordUsage('tab-2', { input_tokens: 5000 })

      const b1 = useTokenBudgetStore.getState().budgets['tab-1']
      const b2 = useTokenBudgetStore.getState().budgets['tab-2']
      expect(b1.inputTokens).toBe(1000)
      expect(b2.inputTokens).toBe(5000)
    })

    it('records the timestamp of last update', () => {
      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now)

      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', { input_tokens: 100 })

      const budget = useTokenBudgetStore.getState().budgets['tab-1']
      expect(budget.lastUpdated).toBe(now)
    })

    it('increments the turn count', () => {
      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', { input_tokens: 100 })
      recordUsage('tab-1', { input_tokens: 200 })
      recordUsage('tab-1', { input_tokens: 300 })

      const budget = useTokenBudgetStore.getState().budgets['tab-1']
      expect(budget.turns).toBe(3)
    })
  })

  // ─── Utilization Calculation ───

  describe('getUtilization', () => {
    it('returns 0 for unknown tabs', () => {
      const { getUtilization } = useTokenBudgetStore.getState()
      expect(getUtilization('unknown')).toBe(0)
    })

    it('calculates utilization as input tokens / max', () => {
      const { recordUsage, getUtilization } = useTokenBudgetStore.getState()
      recordUsage('tab-1', { input_tokens: 100_000 })

      // Re-get since recordUsage creates new state
      const util = useTokenBudgetStore.getState().getUtilization('tab-1')
      expect(util).toBe(0.5) // 100k / 200k
    })

    it('caps utilization at 1.0', () => {
      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', { input_tokens: 300_000 })

      const util = useTokenBudgetStore.getState().getUtilization('tab-1')
      expect(util).toBe(1.0)
    })
  })

  // ─── Threshold Detection ───

  describe('getThresholdLevel', () => {
    it('returns "normal" below 70%', () => {
      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', { input_tokens: 100_000 }) // 50%

      const level = useTokenBudgetStore.getState().getThresholdLevel('tab-1')
      expect(level).toBe('normal')
    })

    it('returns "warning" at 70-84%', () => {
      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', { input_tokens: 150_000 }) // 75%

      const level = useTokenBudgetStore.getState().getThresholdLevel('tab-1')
      expect(level).toBe('warning')
    })

    it('returns "critical" at 85%+', () => {
      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', { input_tokens: 180_000 }) // 90%

      const level = useTokenBudgetStore.getState().getThresholdLevel('tab-1')
      expect(level).toBe('critical')
    })

    it('returns "normal" for unknown tabs', () => {
      const level = useTokenBudgetStore.getState().getThresholdLevel('nope')
      expect(level).toBe('normal')
    })
  })

  // ─── Category Breakdown ───

  describe('getCategories', () => {
    it('returns empty array for unknown tabs', () => {
      const cats = useTokenBudgetStore.getState().getCategories('nope')
      expect(cats).toEqual([])
    })

    it('returns categorized breakdown with percentages', () => {
      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', {
        input_tokens: 10_000,
        output_tokens: 5_000,
        cache_read_input_tokens: 3_000,
        cache_creation_input_tokens: 2_000,
      })

      const cats = useTokenBudgetStore.getState().getCategories('tab-1')
      expect(cats).toHaveLength(4)

      const input = cats.find((c: TokenCategory) => c.label === 'Input')
      expect(input).toBeDefined()
      expect(input!.tokens).toBe(10_000)
      expect(input!.percentage).toBeCloseTo(0.5) // 10k / 20k total

      const output = cats.find((c: TokenCategory) => c.label === 'Output')
      expect(output).toBeDefined()
      expect(output!.tokens).toBe(5_000)

      const cacheRead = cats.find((c: TokenCategory) => c.label === 'Cache Read')
      expect(cacheRead).toBeDefined()
      expect(cacheRead!.tokens).toBe(3_000)

      const cacheWrite = cats.find((c: TokenCategory) => c.label === 'Cache Write')
      expect(cacheWrite).toBeDefined()
      expect(cacheWrite!.tokens).toBe(2_000)
    })

    it('excludes zero-token categories', () => {
      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', { input_tokens: 10_000, output_tokens: 5_000 })

      const cats = useTokenBudgetStore.getState().getCategories('tab-1')
      expect(cats).toHaveLength(2)
      expect(cats.map((c: TokenCategory) => c.label)).toEqual(['Input', 'Output'])
    })
  })

  // ─── Headroom ───

  describe('getHeadroom', () => {
    it('returns max tokens for unknown tabs', () => {
      const headroom = useTokenBudgetStore.getState().getHeadroom('nope')
      expect(headroom).toBe(DEFAULT_MAX_TOKENS)
    })

    it('returns remaining tokens', () => {
      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', { input_tokens: 50_000 })

      const headroom = useTokenBudgetStore.getState().getHeadroom('tab-1')
      expect(headroom).toBe(150_000)
    })

    it('never goes below 0', () => {
      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', { input_tokens: 300_000 })

      const headroom = useTokenBudgetStore.getState().getHeadroom('tab-1')
      expect(headroom).toBe(0)
    })
  })

  // ─── Reset ───

  describe('resetTab', () => {
    it('removes budget for a specific tab', () => {
      const { recordUsage, resetTab } = useTokenBudgetStore.getState()
      recordUsage('tab-1', { input_tokens: 1000 })
      recordUsage('tab-2', { input_tokens: 2000 })

      useTokenBudgetStore.getState().resetTab('tab-1')

      const state = useTokenBudgetStore.getState()
      expect(state.budgets['tab-1']).toBeUndefined()
      expect(state.budgets['tab-2']).toBeDefined()
    })

    it('is a no-op for unknown tabs', () => {
      const { resetTab } = useTokenBudgetStore.getState()
      expect(() => resetTab('nope')).not.toThrow()
    })
  })

  // ─── setMaxContextTokens ───

  describe('setMaxContextTokens', () => {
    it('updates the max context tokens', () => {
      useTokenBudgetStore.getState().setMaxContextTokens(128_000)
      expect(useTokenBudgetStore.getState().maxContextTokens).toBe(128_000)
    })

    it('affects utilization calculations', () => {
      const { recordUsage } = useTokenBudgetStore.getState()
      recordUsage('tab-1', { input_tokens: 64_000 })

      useTokenBudgetStore.getState().setMaxContextTokens(128_000)

      const util = useTokenBudgetStore.getState().getUtilization('tab-1')
      expect(util).toBe(0.5) // 64k / 128k
    })
  })
})
