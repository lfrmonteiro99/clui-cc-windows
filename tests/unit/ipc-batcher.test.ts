import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { IpcEventBatcher } from '../../src/main/ipc-batcher'

describe('IpcEventBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes accumulated events after 16ms', () => {
    const broadcast = vi.fn()
    const batcher = new IpcEventBatcher(broadcast)

    batcher.send('test-channel', 'tab1', { type: 'text_chunk', text: 'hello' })
    batcher.send('test-channel', 'tab1', { type: 'text_chunk', text: ' world' })

    expect(broadcast).not.toHaveBeenCalled()

    vi.advanceTimersByTime(16)

    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenCalledWith('test-channel', [
      { tabId: 'tab1', event: { type: 'text_chunk', text: 'hello' } },
      { tabId: 'tab1', event: { type: 'text_chunk', text: ' world' } },
    ])
  })

  it('flushes immediately when batch reaches 50 events', () => {
    const broadcast = vi.fn()
    const batcher = new IpcEventBatcher(broadcast)

    for (let i = 0; i < 50; i++) {
      batcher.send('test-channel', 'tab1', { type: 'text_chunk', text: `chunk${i}` })
    }

    // Should have flushed before timer fires
    expect(broadcast).toHaveBeenCalledTimes(1)
    const batched = broadcast.mock.calls[0][1] as Array<{ tabId: string; event: unknown }>
    expect(batched).toHaveLength(50)
  })

  it('passes through non-batched events immediately', () => {
    const broadcast = vi.fn()
    const batcher = new IpcEventBatcher(broadcast)

    batcher.sendImmediate('other-channel', 'tab1', 'running', 'idle')

    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenCalledWith('other-channel', 'tab1', 'running', 'idle')
  })

  it('does not double-flush after 16ms if already flushed at 50 events', () => {
    const broadcast = vi.fn()
    const batcher = new IpcEventBatcher(broadcast)

    for (let i = 0; i < 50; i++) {
      batcher.send('test-channel', 'tab1', { type: 'text_chunk', text: `chunk${i}` })
    }

    expect(broadcast).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(16)

    // No additional flush call since batch was already flushed
    expect(broadcast).toHaveBeenCalledTimes(1)
  })

  it('starts a new batch after flush', () => {
    const broadcast = vi.fn()
    const batcher = new IpcEventBatcher(broadcast)

    batcher.send('test-channel', 'tab1', { type: 'text_chunk', text: 'first' })
    vi.advanceTimersByTime(16)

    expect(broadcast).toHaveBeenCalledTimes(1)

    // Second batch
    batcher.send('test-channel', 'tab1', { type: 'text_chunk', text: 'second' })
    vi.advanceTimersByTime(16)

    expect(broadcast).toHaveBeenCalledTimes(2)
    const secondBatch = broadcast.mock.calls[1][1] as Array<{ tabId: string; event: unknown }>
    expect(secondBatch).toHaveLength(1)
    expect(secondBatch[0].event).toEqual({ type: 'text_chunk', text: 'second' })
  })

  it('handles events from multiple tabs in same batch', () => {
    const broadcast = vi.fn()
    const batcher = new IpcEventBatcher(broadcast)

    batcher.send('test-channel', 'tab1', { type: 'text_chunk', text: 'from-tab1' })
    batcher.send('test-channel', 'tab2', { type: 'text_chunk', text: 'from-tab2' })

    vi.advanceTimersByTime(16)

    expect(broadcast).toHaveBeenCalledTimes(1)
    const batched = broadcast.mock.calls[0][1] as Array<{ tabId: string; event: unknown }>
    expect(batched).toHaveLength(2)
    expect(batched[0].tabId).toBe('tab1')
    expect(batched[1].tabId).toBe('tab2')
  })

  it('flush() forces immediate dispatch of pending events', () => {
    const broadcast = vi.fn()
    const batcher = new IpcEventBatcher(broadcast)

    batcher.send('test-channel', 'tab1', { type: 'text_chunk', text: 'pending' })
    expect(broadcast).not.toHaveBeenCalled()

    batcher.flush()
    expect(broadcast).toHaveBeenCalledTimes(1)
  })

  it('flush() does nothing when batch is empty', () => {
    const broadcast = vi.fn()
    const batcher = new IpcEventBatcher(broadcast)

    batcher.flush()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('destroy() cancels pending timer', () => {
    const broadcast = vi.fn()
    const batcher = new IpcEventBatcher(broadcast)

    batcher.send('test-channel', 'tab1', { type: 'text_chunk', text: 'pending' })
    batcher.destroy()

    vi.advanceTimersByTime(100)

    // Should not have broadcast anything after destroy
    expect(broadcast).not.toHaveBeenCalled()
  })
})
