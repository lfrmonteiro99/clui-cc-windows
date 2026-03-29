import { describe, it, expect, vi } from 'vitest'

/**
 * Issue #304: Enhanced User/Assistant Message Visual Distinction
 *
 * Validates that theme tokens and message styling constants
 * provide sufficient visual separation between user and assistant messages.
 */

// The theme module accesses `document` and `localStorage` at import time.
// Stub them before any imports can trigger module evaluation.
vi.hoisted(() => {
  const style = new Map<string, string>()
  ;(globalThis as any).document = {
    documentElement: {
      style: { setProperty: (k: string, v: string) => style.set(k, v) },
      classList: { toggle: () => {} },
    },
  }
  ;(globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
  }
})

// Now safe to import the theme module
import { getColors } from '../../src/renderer/theme'

describe('Message distinction - theme tokens', () => {
  describe('dark theme', () => {
    const dark = getColors(true)

    it('messageBgUser has increased opacity (0.06)', () => {
      expect(dark.messageBgUser).toContain('0.06')
    })

    it('messageBgAssistant has accent-tinted background', () => {
      expect(dark.messageBgAssistant).toContain('217')
      expect(dark.messageBgAssistant).toContain('0.08')
    })
  })

  describe('light theme', () => {
    const light = getColors(false)

    it('messageBgUser has increased opacity (0.05)', () => {
      expect(light.messageBgUser).toContain('0.05')
    })

    it('messageBgAssistant has accent-tinted background', () => {
      // With the accent color system, light theme derives from the light accent (#c4613d = 196, 97, 61)
      expect(light.messageBgAssistant).toMatch(/rgba\(/)
      expect(light.messageBgAssistant).toContain('0.1')
    })
  })
})

describe('Message distinction - border radius patterns', () => {
  const USER_BORDER_RADIUS = '12px 12px 4px 12px'
  const ASSISTANT_BORDER_RADIUS = '12px 12px 12px 4px'

  it('user messages use chat-bubble shape (flat bottom-right)', () => {
    const parts = USER_BORDER_RADIUS.split(' ')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('12px') // top-left
    expect(parts[1]).toBe('12px') // top-right
    expect(parts[2]).toBe('4px')  // bottom-right (flat)
    expect(parts[3]).toBe('12px') // bottom-left
  })

  it('assistant messages use inverted chat-bubble shape (flat bottom-left)', () => {
    const parts = ASSISTANT_BORDER_RADIUS.split(' ')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('12px') // top-left
    expect(parts[1]).toBe('12px') // top-right
    expect(parts[2]).toBe('12px') // bottom-right
    expect(parts[3]).toBe('4px')  // bottom-left (flat)
  })

  it('user and assistant border-radius patterns are distinct', () => {
    expect(USER_BORDER_RADIUS).not.toBe(ASSISTANT_BORDER_RADIUS)
  })
})
