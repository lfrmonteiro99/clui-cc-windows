import { describe, expect, it } from 'vitest'
import { detectReferences } from '../../src/shared/reference-detect'
import type { Reference } from '../../src/shared/reference-detect'

function types(refs: Reference[]): string[] {
  return refs.map((r) => r.type)
}

describe('detectReferences', () => {
  // ─── URLs ───

  it('detects http URLs', () => {
    const refs = detectReferences('Visit http://example.com for more')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('url')
    expect(refs[0].value).toBe('http://example.com')
  })

  it('detects https URLs with paths and query params', () => {
    const refs = detectReferences('See https://github.com/user/repo?tab=issues&q=bug')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('url')
    expect(refs[0].value).toBe('https://github.com/user/repo?tab=issues&q=bug')
  })

  it('does not detect URLs inside markdown link syntax', () => {
    const refs = detectReferences('Check [this link](https://example.com) out')
    // The URL inside parentheses should be skipped
    expect(refs.filter((r) => r.type === 'url')).toHaveLength(0)
  })

  it('strips trailing punctuation from URLs', () => {
    const refs = detectReferences('Go to https://example.com/page.')
    expect(refs[0].value).toBe('https://example.com/page')
  })

  // ─── File Paths ───

  it('detects Unix file paths', () => {
    const refs = detectReferences('Edit the file ./src/main.ts to fix it')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('filepath')
    expect(refs[0].value).toBe('./src/main.ts')
  })

  it('detects Windows file paths', () => {
    const refs = detectReferences('Found at C:\\Users\\test\\file.txt in the system')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('filepath')
    expect(refs[0].value).toBe('C:\\Users\\test\\file.txt')
  })

  it('does not confuse URLs with file paths', () => {
    const refs = detectReferences('See https://example.com/path/to/file.ts')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('url')
  })

  // ─── GitHub Refs ───

  it('detects simple issue refs like #123', () => {
    const refs = detectReferences('Fixed in #123')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('github-ref')
    expect(refs[0].text).toBe('#123')
  })

  it('detects owner/repo#123 refs', () => {
    const refs = detectReferences('See facebook/react#456 for details')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('github-ref')
    expect(refs[0].text).toBe('facebook/react#456')
    expect(refs[0].value).toBe('https://github.com/facebook/react/issues/456')
  })

  it('does not match # inside words', () => {
    const refs = detectReferences('color#123 is not a ref')
    expect(refs.filter((r) => r.type === 'github-ref')).toHaveLength(0)
  })

  // ─── Hex Colors ───

  it('detects 3-digit hex colors', () => {
    const refs = detectReferences('Use color #fff for white')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('color')
    expect(refs[0].value).toBe('#fff')
  })

  it('detects 6-digit hex colors', () => {
    const refs = detectReferences('The color #ff0000 is red')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('color')
    expect(refs[0].value).toBe('#ff0000')
  })

  it('detects 8-digit hex colors with alpha', () => {
    const refs = detectReferences('Semi-transparent: #ff000080')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('color')
    expect(refs[0].value).toBe('#ff000080')
  })

  it('does not treat #123 as a color (it is a GitHub ref)', () => {
    const refs = detectReferences('Issue #123 needs fixing')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('github-ref')
  })

  it('does not treat #1234 as a color (4 pure digits = GitHub ref)', () => {
    const refs = detectReferences('See #1234 for details')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('github-ref')
  })

  it('treats #abc as a color (3 hex chars with letters)', () => {
    const refs = detectReferences('Color #abc is valid')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('color')
  })

  // ─── Mixed Content ───

  it('detects multiple reference types in one string', () => {
    const text = 'Fix #42 in ./src/app.ts, see https://example.com and use #ff0000'
    const refs = detectReferences(text)
    expect(types(refs)).toEqual(['github-ref', 'filepath', 'url', 'color'])
  })

  // ─── Edge Cases ───

  it('returns empty array for empty string', () => {
    expect(detectReferences('')).toEqual([])
  })

  it('returns empty array for text with no references', () => {
    expect(detectReferences('Just some plain text without references')).toEqual([])
  })

  it('handles long text without catastrophic backtracking', () => {
    const longText = 'a '.repeat(10000) + 'https://example.com ' + 'b '.repeat(10000)
    const start = performance.now()
    const refs = detectReferences(longText)
    const elapsed = performance.now() - start
    expect(refs).toHaveLength(1)
    expect(elapsed).toBeLessThan(500) // should be well under 500ms
  })
})
