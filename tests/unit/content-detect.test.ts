import { describe, it, expect } from 'vitest'
import { detectContentType } from '../../src/shared/content-detect'

describe('detectContentType', () => {
  it('returns "Writing..." for empty string', () => {
    expect(detectContentType('')).toBe('Writing...')
  })

  it('returns "Writing..." for plain text', () => {
    expect(detectContentType('Hello, this is a simple explanation.')).toBe('Writing...')
  })

  it('detects open code fence as "Writing code..."', () => {
    const text = 'Here is some code:\n```typescript\nconst x = 1;\n'
    expect(detectContentType(text)).toBe('Writing code...')
  })

  it('returns "Writing..." when code fence is closed', () => {
    const text = 'Here is some code:\n```typescript\nconst x = 1;\n```\nDone.'
    expect(detectContentType(text)).toBe('Writing...')
  })

  it('detects numbered list with 2 items as "Listing steps (2)..."', () => {
    const text = '1. First step\n2. Second step\n'
    expect(detectContentType(text)).toBe('Listing steps (2)...')
  })

  it('detects numbered list with 5 items', () => {
    const text = '1. A\n2. B\n3. C\n4. D\n5. E\n'
    expect(detectContentType(text)).toBe('Listing steps (5)...')
  })

  it('does not detect single numbered item as list', () => {
    const text = '1. Only one item here\n'
    expect(detectContentType(text)).toBe('Writing...')
  })

  it('detects table separator as "Generating table..."', () => {
    const text = '| Name | Value |\n|------|-------|\n| foo  | bar   |'
    expect(detectContentType(text)).toBe('Generating table...')
  })

  it('detects heading as "Structuring response..."', () => {
    const text = '## Overview\nSome explanation here.'
    expect(detectContentType(text)).toBe('Structuring response...')
  })

  it('detects ### heading as "Structuring response..."', () => {
    const text = '### Details\nMore info.'
    expect(detectContentType(text)).toBe('Structuring response...')
  })

  it('prioritizes code fence over numbered list', () => {
    const text = '1. Step one\n2. Step two\n```python\nprint("hello")\n'
    expect(detectContentType(text)).toBe('Writing code...')
  })

  it('prioritizes numbered list over table', () => {
    const text = '1. First\n2. Second\n| col |---| val |'
    expect(detectContentType(text)).toBe('Listing steps (2)...')
  })

  it('prioritizes table over heading', () => {
    const text = '## Title\n| Name | Value |\n|------|-------|\n| a | b |'
    expect(detectContentType(text)).toBe('Generating table...')
  })

  it('completes detection on 500 chars in under 1ms', () => {
    const text = 'a'.repeat(500)
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      detectContentType(text)
    }
    const elapsed = (performance.now() - start) / 1000
    expect(elapsed).toBeLessThan(1)
  })
})
