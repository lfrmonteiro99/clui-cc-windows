import type { NormalizedEvent } from '../shared/types'

/** Batch entry: one event tagged with its tab ID */
interface BatchEntry {
  tabId: string
  event: NormalizedEvent
}

/**
 * IpcEventBatcher: accumulates high-frequency IPC events and flushes them
 * as a single batched array to reduce IPC overhead during streaming.
 *
 * - High-frequency events (text_chunk, tool_call_update) are batched.
 * - Batch flushes every 16ms (one frame) or when it reaches 50 events.
 * - All other events pass through immediately via sendImmediate().
 *
 * The renderer receives either:
 *   - channel, [BatchEntry, ...] — for batched events
 *   - channel, ...args          — for immediate pass-through events
 */
export class IpcEventBatcher {
  private batch: BatchEntry[] = []
  private channel: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly FLUSH_INTERVAL_MS = 16
  private readonly MAX_BATCH_SIZE = 50

  constructor(private readonly broadcast: (channel: string, ...args: unknown[]) => void) {}

  /**
   * Queue a high-frequency event for batched delivery.
   * Starts the flush timer if not already running.
   */
  send(channel: string, tabId: string, event: NormalizedEvent): void {
    // Track the channel for flush (all batched events go to the same channel)
    if (this.channel === null) {
      this.channel = channel
    }

    this.batch.push({ tabId, event })

    // Start timer on first item in a new batch
    if (this.timer === null) {
      this.timer = setTimeout(() => this._flush(), this.FLUSH_INTERVAL_MS)
    }

    // Flush immediately if batch reaches max size
    if (this.batch.length >= this.MAX_BATCH_SIZE) {
      this._flush()
    }
  }

  /**
   * Send a non-batched event immediately, bypassing the accumulator.
   * Use for low-frequency events like tab-status-change, error, etc.
   */
  sendImmediate(channel: string, ...args: unknown[]): void {
    this.broadcast(channel, ...args)
  }

  /**
   * Force-flush any pending events immediately.
   */
  flush(): void {
    if (this.batch.length > 0) {
      this._flush()
    }
  }

  /**
   * Cancel pending timer and discard any buffered events.
   * Call on shutdown to prevent timer callbacks after cleanup.
   */
  destroy(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.batch = []
    this.channel = null
  }

  private _flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }

    if (this.batch.length === 0) return

    const channel = this.channel!
    const entries = this.batch
    this.batch = []
    this.channel = null

    this.broadcast(channel, entries)
  }
}
