import { describe, it, expect, beforeEach } from 'vitest'
import { useModelRouterStore } from '../../src/renderer/stores/modelRouterStore'

describe('modelRouterStore', () => {
  beforeEach(() => {
    useModelRouterStore.setState({
      enabled: true,
      mode: 'auto',
      overrides: {},
      thresholds: { haiku: 30, sonnet: 65 },
      routingHistory: [],
    })
  })

  // ─── Basic state ───

  it('starts with auto mode enabled', () => {
    const state = useModelRouterStore.getState()
    expect(state.enabled).toBe(true)
    expect(state.mode).toBe('auto')
  })

  it('toggles enabled', () => {
    useModelRouterStore.getState().setEnabled(false)
    expect(useModelRouterStore.getState().enabled).toBe(false)
  })

  it('switches mode', () => {
    useModelRouterStore.getState().setMode('manual')
    expect(useModelRouterStore.getState().mode).toBe('manual')
  })

  // ─── resolveModel ───

  it('returns preferredModel when mode is manual', () => {
    useModelRouterStore.getState().setMode('manual')
    const model = useModelRouterStore.getState().resolveModel('tab1', 'explain promises', 'claude-opus-4-6')
    expect(model).toBe('claude-opus-4-6')
  })

  it('returns preferredModel when routing is disabled', () => {
    useModelRouterStore.getState().setEnabled(false)
    const model = useModelRouterStore.getState().resolveModel('tab1', 'explain promises', 'claude-opus-4-6')
    expect(model).toBe('claude-opus-4-6')
  })

  it('routes simple prompts to Haiku in auto mode', () => {
    const model = useModelRouterStore.getState().resolveModel('tab1', 'what is a closure?', null)
    expect(model).toBe('claude-haiku-4-5-20251001')
  })

  it('routes complex prompts to Opus in auto mode', () => {
    const model = useModelRouterStore.getState().resolveModel(
      'tab1',
      'refactor the entire authentication system across all microservices, implement OAuth2 with JWT, and add comprehensive integration tests for every endpoint',
      null,
    )
    expect(model).toBe('claude-opus-4-6')
  })

  it('routes medium prompts to Sonnet in auto mode', () => {
    const model = useModelRouterStore.getState().resolveModel(
      'tab1',
      'fix the bug in src/parser.ts where it crashes on empty input',
      null,
    )
    expect(model).toBe('claude-sonnet-4-6')
  })

  // ─── Per-tab overrides ───

  it('uses per-tab override when set', () => {
    useModelRouterStore.getState().setTabOverride('tab1', 'claude-opus-4-6')
    const model = useModelRouterStore.getState().resolveModel('tab1', 'what is 2+2?', null)
    expect(model).toBe('claude-opus-4-6')
  })

  it('clears per-tab override when set to null', () => {
    useModelRouterStore.getState().setTabOverride('tab1', 'claude-opus-4-6')
    useModelRouterStore.getState().setTabOverride('tab1', null)
    const model = useModelRouterStore.getState().resolveModel('tab1', 'what is 2+2?', null)
    expect(model).toBe('claude-haiku-4-5-20251001')
  })

  // ─── Routing history ───

  it('records routing decisions in history', () => {
    useModelRouterStore.getState().resolveModel('tab1', 'explain closures', null)
    const history = useModelRouterStore.getState().routingHistory
    expect(history).toHaveLength(1)
    expect(history[0].tabId).toBe('tab1')
    expect(history[0].model).toBe('claude-haiku-4-5-20251001')
    expect(history[0].score).toBeGreaterThanOrEqual(0)
  })

  it('limits routing history to 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      useModelRouterStore.getState().resolveModel(`tab${i}`, 'hello', null)
    }
    expect(useModelRouterStore.getState().routingHistory.length).toBeLessThanOrEqual(50)
  })

  // ─── getLastRouting ───

  it('returns last routing for a tab', () => {
    useModelRouterStore.getState().resolveModel('tab1', 'explain closures', null)
    const last = useModelRouterStore.getState().getLastRouting('tab1')
    expect(last).not.toBeNull()
    expect(last!.model).toBe('claude-haiku-4-5-20251001')
  })

  it('returns null for tab with no history', () => {
    const last = useModelRouterStore.getState().getLastRouting('unknown-tab')
    expect(last).toBeNull()
  })

  // ─── Thresholds ───

  it('respects custom thresholds', () => {
    useModelRouterStore.getState().setThresholds({ haiku: 80, sonnet: 95 })
    // A normally medium prompt should now route to Haiku
    const model = useModelRouterStore.getState().resolveModel('tab1', 'fix the bug in parser.ts', null)
    expect(model).toBe('claude-haiku-4-5-20251001')
  })

  // ─── getSavingsEstimate ───

  it('estimates savings compared to always using Opus', () => {
    useModelRouterStore.getState().resolveModel('tab1', 'what is a closure?', null)
    const savings = useModelRouterStore.getState().getSavingsEstimate()
    expect(savings).toHaveProperty('routedToHaiku')
    expect(savings).toHaveProperty('routedToSonnet')
    expect(savings).toHaveProperty('routedToOpus')
    expect(savings.routedToHaiku).toBe(1)
    expect(savings.routedToSonnet).toBe(0)
    expect(savings.routedToOpus).toBe(0)
  })
})
