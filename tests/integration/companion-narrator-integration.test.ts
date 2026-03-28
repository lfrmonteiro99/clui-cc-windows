/**
 * ENRICH-009: Companion Narrator — Integration Tests
 *
 * Tests context buffer, idle gap detection, rate limiting, stop behavior,
 * and prompt construction.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompanionNarrator, type NarratorEvent } from '../../src/shared/enrich/companion-narrator'

describe('ENRICH-009: Companion Narrator Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('context buffer: 15 tool_call events → buffer stays at 10', () => {
    const onIdleGap = vi.fn()
    const narrator = new CompanionNarrator(onIdleGap, { bufferSize: 10 })

    for (let i = 0; i < 15; i++) {
      narrator.pushEvent({
        type: 'tool_call',
        toolName: `Tool${i}`,
        timestamp: Date.now(),
      })
    }

    const buffer = narrator.getBuffer()
    expect(buffer.length).toBe(10)
    // Should keep the most recent 10
    expect(buffer[0].toolName).toBe('Tool5')
    expect(buffer[9].toolName).toBe('Tool14')
  })

  it('idle gap detection: tool_call_complete → wait 3s+ → onIdleGap triggered', () => {
    const onIdleGap = vi.fn()
    const narrator = new CompanionNarrator(onIdleGap, {
      idleGapMs: 3000,
      minIntervalMs: 0, // disable rate limiting for this test
    })

    narrator.pushEvent({ type: 'tool_call', toolName: 'Read', timestamp: Date.now() })
    narrator.pushEvent({ type: 'tool_call_complete', timestamp: Date.now() })

    expect(onIdleGap).not.toHaveBeenCalled()

    // Advance past idle gap threshold
    vi.advanceTimersByTime(3100)

    expect(onIdleGap).toHaveBeenCalledTimes(1)
    expect(onIdleGap).toHaveBeenCalledWith(expect.any(Array))
  })

  it('rate limiting: 2 idle gaps within 8s → only 1 commentary generated', () => {
    const onIdleGap = vi.fn()
    const narrator = new CompanionNarrator(onIdleGap, {
      idleGapMs: 1000,
      minIntervalMs: 8000,
    })

    // First tool call complete
    narrator.pushEvent({ type: 'tool_call_complete', timestamp: Date.now() })
    vi.advanceTimersByTime(1100) // triggers idle gap
    expect(onIdleGap).toHaveBeenCalledTimes(1)

    // Second tool call complete — within minInterval
    vi.advanceTimersByTime(2000) // only 3.1s total since first commentary
    narrator.pushEvent({ type: 'tool_call_complete', timestamp: Date.now() })
    vi.advanceTimersByTime(1100) // would trigger idle gap, but rate limited
    expect(onIdleGap).toHaveBeenCalledTimes(1) // still 1, not 2
  })

  it('stops on task_complete: no more commentary after stop', () => {
    const onIdleGap = vi.fn()
    const narrator = new CompanionNarrator(onIdleGap, {
      idleGapMs: 1000,
      minIntervalMs: 0,
    })

    // task_complete should stop the narrator
    narrator.pushEvent({ type: 'task_complete', timestamp: Date.now() })

    expect(narrator.isStopped()).toBe(true)

    // Further events should be ignored
    narrator.pushEvent({ type: 'tool_call_complete', timestamp: Date.now() })
    vi.advanceTimersByTime(2000)

    expect(onIdleGap).not.toHaveBeenCalled()
  })

  it('stop() prevents further commentary', () => {
    const onIdleGap = vi.fn()
    const narrator = new CompanionNarrator(onIdleGap, {
      idleGapMs: 1000,
      minIntervalMs: 0,
    })

    narrator.pushEvent({ type: 'tool_call_complete', timestamp: Date.now() })
    narrator.stop()

    vi.advanceTimersByTime(2000)
    expect(onIdleGap).not.toHaveBeenCalled()
    expect(narrator.isStopped()).toBe(true)
  })

  it('prompt construction includes recent tool calls context', () => {
    const context: NarratorEvent[] = [
      { type: 'tool_call', toolName: 'Read', timestamp: 1 },
      { type: 'tool_call_complete', timestamp: 2 },
      { type: 'tool_call', toolName: 'Edit', timestamp: 3 },
      { type: 'tool_call', toolName: 'Read', timestamp: 4 }, // duplicate tool
    ]

    const prompt = CompanionNarrator.buildPrompt(context)
    expect(prompt).toContain('Recent tool activity:')
    expect(prompt).toContain('Used Read')
    expect(prompt).toContain('Used Edit')
    expect(prompt).toContain('Provide a brief, helpful commentary')
  })

  it('buildPrompt returns empty for empty context', () => {
    expect(CompanionNarrator.buildPrompt([])).toBe('')
  })

  it('idle timer resets on new activity before gap expires', () => {
    const onIdleGap = vi.fn()
    const narrator = new CompanionNarrator(onIdleGap, {
      idleGapMs: 3000,
      minIntervalMs: 0,
    })

    narrator.pushEvent({ type: 'tool_call_complete', timestamp: Date.now() })

    // Advance 2s (not enough for idle gap)
    vi.advanceTimersByTime(2000)
    expect(onIdleGap).not.toHaveBeenCalled()

    // New activity resets the timer
    narrator.pushEvent({ type: 'tool_call', toolName: 'Bash', timestamp: Date.now() })
    narrator.pushEvent({ type: 'tool_call_complete', timestamp: Date.now() })

    // Advance 2s again — still not enough since timer was reset
    vi.advanceTimersByTime(2000)
    expect(onIdleGap).not.toHaveBeenCalled()

    // Now advance enough for idle gap
    vi.advanceTimersByTime(1100)
    expect(onIdleGap).toHaveBeenCalledTimes(1)
  })

  it('buffer is passed as copy to onIdleGap callback', () => {
    let capturedContext: NarratorEvent[] | null = null
    const onIdleGap = vi.fn((ctx: NarratorEvent[]) => { capturedContext = ctx })
    const narrator = new CompanionNarrator(onIdleGap, {
      idleGapMs: 1000,
      minIntervalMs: 0,
    })

    narrator.pushEvent({ type: 'tool_call', toolName: 'Read', timestamp: 1 })
    narrator.pushEvent({ type: 'tool_call_complete', timestamp: 2 })

    vi.advanceTimersByTime(1100)

    expect(capturedContext).not.toBeNull()
    expect(capturedContext!.length).toBe(2)

    // Modifying the captured context should not affect the narrator's buffer
    capturedContext!.push({ type: 'fake', timestamp: 999 })
    expect(narrator.getBuffer().length).toBe(2)
  })
})
