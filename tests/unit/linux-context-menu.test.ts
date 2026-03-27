import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for #260 LINUX-005: Context menu labels should differ on Linux.
 *
 * The reveal label should be:
 * - macOS: "Reveal in Finder"
 * - Linux: "Show in File Manager"
 * - Windows: "Reveal in Explorer"
 */

describe('context menu Linux labels (#260)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns "Reveal in Finder" on macOS', async () => {
    // Mock navigator.userAgent for macOS
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      writable: true,
      configurable: true,
    })

    const { getRevealLabel } = await import('../../src/renderer/stores/contextMenuStore')
    expect(getRevealLabel()).toBe('Reveal in Finder')
  })

  it('returns "Show in File Manager" on Linux', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' },
      writable: true,
      configurable: true,
    })

    const { getRevealLabel } = await import('../../src/renderer/stores/contextMenuStore')
    expect(getRevealLabel()).toBe('Show in File Manager')
  })

  it('returns "Reveal in Explorer" on Windows', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      writable: true,
      configurable: true,
    })

    const { getRevealLabel } = await import('../../src/renderer/stores/contextMenuStore')
    expect(getRevealLabel()).toBe('Reveal in Explorer')
  })
})
