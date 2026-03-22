import { Readable } from 'stream'
import { EventEmitter } from 'events'
import type { ClaudeEvent } from '../shared/types'

/**
 * Parses NDJSON output from `claude -p --output-format stream-json`.
 * Each line is a JSON object. Unknown event types are emitted but never crash.
 *
 * Uses a chunk array and leftover string instead of string concatenation to
 * avoid O(n²) cost when many small chunks arrive during streaming.
 */
export class StreamParser extends EventEmitter {
  /** Accumulated chunks not yet split into lines */
  private chunks: string[] = []
  /** Total bytes in chunks (for overflow guard) */
  private bufferedBytes = 0
  /** Incomplete last line carried over from the previous feed */
  private leftover = ''

  /** Maximum buffer size (10MB). Prevents OOM from malformed/infinite streams. */
  private static readonly MAX_BUFFER_SIZE = 10 * 1024 * 1024

  /**
   * Feed a chunk of data (from stdout) into the parser.
   * Emits 'event' for each parsed JSON line.
   */
  feed(chunk: string): void {
    this.bufferedBytes += chunk.length

    // Safety: if buffer grows beyond limit, discard it to prevent OOM
    if (this.bufferedBytes > StreamParser.MAX_BUFFER_SIZE) {
      this.emit('parse-error', `[buffer overflow] Discarded ${this.bufferedBytes} bytes`)
      this.chunks = []
      this.bufferedBytes = 0
      this.leftover = ''
      return
    }

    this.chunks.push(chunk)

    // Only join when at least one newline is present to avoid unnecessary joins
    const combined = this.chunks.join('')
    if (!combined.includes('\n')) {
      // No complete lines yet — keep chunks accumulated
      return
    }

    // Reset chunk accumulator; we're about to process
    this.chunks = []
    this.bufferedBytes = 0

    const full = this.leftover + combined
    const lines = full.split('\n')
    // Keep the last (possibly incomplete) line as leftover
    this.leftover = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as ClaudeEvent
        this.emit('event', parsed)
      } catch {
        // Non-JSON line (e.g. stderr mixed in) — log but don't crash
        this.emit('parse-error', trimmed)
      }
    }
  }

  /**
   * Flush any remaining data in the buffer (call when stream ends).
   */
  flush(): void {
    // Join any pending chunks with existing leftover
    const remaining = this.leftover + this.chunks.join('')
    this.chunks = []
    this.bufferedBytes = 0
    this.leftover = ''

    const trimmed = remaining.trim()
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed) as ClaudeEvent
        this.emit('event', parsed)
      } catch {
        this.emit('parse-error', trimmed)
      }
    }
  }

  /**
   * Convenience: pipe a readable stream through the parser.
   */
  static fromStream(stream: Readable): StreamParser {
    const parser = new StreamParser()
    stream.setEncoding('utf-8')
    stream.on('data', (chunk: string) => parser.feed(chunk))
    stream.on('end', () => parser.flush())
    return parser
  }
}
