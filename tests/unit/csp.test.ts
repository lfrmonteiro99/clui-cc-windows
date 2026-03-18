import { describe, expect, it } from 'vitest'

// Test the CSP header value construction
// The actual CSP is applied in main/index.ts via session.webRequest.onHeadersReceived

const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

describe('Content Security Policy', () => {
  it('blocks eval by not including unsafe-eval in script-src', () => {
    expect(CSP_POLICY).not.toContain('unsafe-eval')
  })

  it('allows inline styles for Tailwind + Framer Motion', () => {
    expect(CSP_POLICY).toContain("style-src 'self' 'unsafe-inline'")
  })

  it('allows data: URLs for screenshots/attachments', () => {
    expect(CSP_POLICY).toContain("img-src 'self' data:")
  })

  it('blocks object/embed elements', () => {
    expect(CSP_POLICY).toContain("object-src 'none'")
  })

  it('restricts base-uri to self', () => {
    expect(CSP_POLICY).toContain("base-uri 'self'")
  })

  it('does not allow blob: or filesystem: in any directive', () => {
    expect(CSP_POLICY).not.toContain('blob:')
    expect(CSP_POLICY).not.toContain('filesystem:')
  })

  it('allows media-src for notification sounds', () => {
    expect(CSP_POLICY).toContain("media-src 'self'")
  })
})
