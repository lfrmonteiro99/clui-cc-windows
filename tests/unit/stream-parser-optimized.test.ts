import { describe, it, expect } from 'vitest'
import { StreamParser } from '../../src/main/stream-parser'
import { Readable } from 'stream'

/**
 * Tests that the optimized (chunk array) StreamParser produces the same results
 * as the original string-concatenation approach.
 */
describe('StreamParser (optimized chunk array)', () => {
  it('parses valid NDJSON split across multiple chunks', async () => {
    const events: unknown[] = []
    const input = new Readable({ read() {} })

    const parser = StreamParser.fromStream(input)
    parser.on('event', (e: unknown) => events.push(e))

    const done = new Promise<void>((resolve) => input.on('end', () => setTimeout(resolve, 50)))

    // Simulate a JSON object split across chunks
    input.push('{"type":"system","sub')
    input.push('type":"init","session_id":"abc"}\n')
    input.push('{"type":"result","result":"done"}\n')
    input.push(null)

    await done

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ type: 'system', subtype: 'init', session_id: 'abc' })
    expect(events[1]).toEqual({ type: 'result', result: 'done' })
  })

  it('handles many small chunks efficiently', async () => {
    const events: unknown[] = []
    const input = new Readable({ read() {} })

    const parser = StreamParser.fromStream(input)
    parser.on('event', (e: unknown) => events.push(e))

    const done = new Promise<void>((resolve) => input.on('end', () => setTimeout(resolve, 50)))

    // Feed character by character (worst case for string concatenation)
    const line = '{"type":"result","result":"done"}\n'
    for (const char of line) {
      input.push(char)
    }
    input.push(null)

    await done

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'result', result: 'done' })
  })

  it('handles multiple lines in a single chunk', async () => {
    const events: unknown[] = []
    const input = new Readable({ read() {} })

    const parser = StreamParser.fromStream(input)
    parser.on('event', (e: unknown) => events.push(e))

    const done = new Promise<void>((resolve) => input.on('end', () => setTimeout(resolve, 50)))

    // All lines in one chunk
    input.push('{"type":"system","subtype":"init","session_id":"s1"}\n{"type":"result","result":"ok"}\n{"type":"assistant","message":{}}\n')
    input.push(null)

    await done

    expect(events).toHaveLength(3)
  })

  it('handles incomplete final line with flush', async () => {
    const events: unknown[] = []
    const errors: string[] = []
    const parser = new StreamParser()
    parser.on('event', (e: unknown) => events.push(e))
    parser.on('parse-error', (line: string) => errors.push(line))

    parser.feed('{"type":"result","result":"flushed"}')
    // No newline — line is incomplete until flush
    expect(events).toHaveLength(0)

    parser.flush()
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'result', result: 'flushed' })
    expect(errors).toHaveLength(0)
  })

  it('does not emit duplicates for lines with trailing newline', async () => {
    const events: unknown[] = []
    const input = new Readable({ read() {} })

    const parser = StreamParser.fromStream(input)
    parser.on('event', (e: unknown) => events.push(e))

    const done = new Promise<void>((resolve) => input.on('end', () => setTimeout(resolve, 50)))

    input.push('{"type":"result"}\n')
    input.push(null) // flush called on end

    await done

    expect(events).toHaveLength(1)
  })

  it('handles buffer overflow by discarding and emitting parse-error', () => {
    const errors: string[] = []
    const parser = new StreamParser()
    parser.on('parse-error', (line: string) => errors.push(line))

    // Feed more than MAX_BUFFER_SIZE (10MB)
    const largeChunk = 'x'.repeat(11 * 1024 * 1024)
    parser.feed(largeChunk)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('buffer overflow')
  })

  it('resumes correctly after buffer overflow', () => {
    const events: unknown[] = []
    const errors: string[] = []
    const parser = new StreamParser()
    parser.on('event', (e: unknown) => events.push(e))
    parser.on('parse-error', (line: string) => errors.push(line))

    // Overflow
    parser.feed('x'.repeat(11 * 1024 * 1024))
    expect(errors).toHaveLength(1)

    // Should work again after overflow reset
    parser.feed('{"type":"result"}\n')
    expect(events).toHaveLength(1)
  })

  it('produces same results as original string-concat approach for mixed input', async () => {
    const events: unknown[] = []
    const errors: string[] = []
    const input = new Readable({ read() {} })

    const parser = StreamParser.fromStream(input)
    parser.on('event', (e: unknown) => events.push(e))
    parser.on('parse-error', (line: string) => errors.push(line))

    const done = new Promise<void>((resolve) => input.on('end', () => setTimeout(resolve, 50)))

    input.push('{"type":"system","subtype":"init","session_id":"abc"}\n')
    input.push('not valid json\n')
    input.push('\n')
    input.push('  \n')
    input.push('{"type":"result","result":"done"}\n')
    input.push(null)

    await done

    expect(events).toHaveLength(2)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('not valid json')
  })
})
