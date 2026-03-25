/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  searchConversation,
  clearSearchHighlights,
  navigateMatch,
  HIGHLIGHT_CLASS,
  HIGHLIGHT_ACTIVE_CLASS,
} from '../useConversationSearch'

// ─── Helpers ───

function createConversationDOM(): HTMLElement {
  const container = document.createElement('div')
  container.setAttribute('data-testid', 'conversation-view')

  // User message
  const userMsg = document.createElement('div')
  userMsg.setAttribute('data-testid', 'message-user')
  userMsg.textContent = 'Hello world, this is a test message'
  container.appendChild(userMsg)

  // Assistant message
  const assistantMsg = document.createElement('div')
  assistantMsg.setAttribute('data-testid', 'message-assistant')
  assistantMsg.textContent = 'Hello! I can help you with your test. This test is great.'
  container.appendChild(assistantMsg)

  // System message
  const systemMsg = document.createElement('div')
  systemMsg.setAttribute('data-testid', 'message-system')
  systemMsg.textContent = 'Session started'
  container.appendChild(systemMsg)

  // UI chrome (should NOT be searched)
  const uiChrome = document.createElement('div')
  uiChrome.setAttribute('data-clui-ui', '')
  uiChrome.textContent = 'test button label with test in it'
  container.appendChild(uiChrome)

  document.body.appendChild(container)
  return container
}

function getHighlights(): HTMLElement[] {
  return Array.from(document.querySelectorAll(`.${HIGHLIGHT_CLASS}`))
}

function getActiveHighlight(): HTMLElement | null {
  return document.querySelector(`.${HIGHLIGHT_ACTIVE_CLASS}`)
}

describe('Conversation Search Engine', () => {
  let container: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    container = createConversationDOM()
  })

  afterEach(() => {
    clearSearchHighlights(container)
    document.body.innerHTML = ''
  })

  describe('searchConversation', () => {
    it('only matches text within conversation message elements', () => {
      // "test" appears in user msg (1x), assistant msg (2x), and UI chrome (2x)
      const result = searchConversation(container, 'test', { caseSensitive: false, regex: false })

      // Should only find matches in message elements, NOT in UI chrome
      expect(result.totalMatches).toBe(3) // 1 in user + 2 in assistant
      expect(getHighlights()).toHaveLength(3)
    })

    it('returns zero matches for empty query', () => {
      const result = searchConversation(container, '', { caseSensitive: false, regex: false })
      expect(result.totalMatches).toBe(0)
      expect(result.currentIndex).toBe(-1)
      expect(getHighlights()).toHaveLength(0)
    })

    it('returns zero matches when no text matches', () => {
      const result = searchConversation(container, 'xyznonexistent', { caseSensitive: false, regex: false })
      expect(result.totalMatches).toBe(0)
      expect(result.currentIndex).toBe(-1)
    })

    it('is case-insensitive by default', () => {
      const result = searchConversation(container, 'hello', { caseSensitive: false, regex: false })
      // "Hello" in user msg + "Hello" in assistant msg
      expect(result.totalMatches).toBe(2)
    })

    it('respects case sensitivity option', () => {
      const result = searchConversation(container, 'hello', { caseSensitive: true, regex: false })
      // Only lowercase "hello" — none exist (both are "Hello")
      expect(result.totalMatches).toBe(0)
    })

    it('supports regex mode', () => {
      const result = searchConversation(container, 'test\\b', { caseSensitive: false, regex: true })
      expect(result.totalMatches).toBe(3)
    })

    it('sets first match as active', () => {
      searchConversation(container, 'test', { caseSensitive: false, regex: false })
      const active = getActiveHighlight()
      expect(active).not.toBeNull()
    })

    it('match count updates when search term changes', () => {
      const r1 = searchConversation(container, 'test', { caseSensitive: false, regex: false })
      expect(r1.totalMatches).toBe(3)

      const r2 = searchConversation(container, 'Hello', { caseSensitive: false, regex: false })
      expect(r2.totalMatches).toBe(2)

      // Previous highlights should be cleared
      expect(getHighlights()).toHaveLength(2)
    })
  })

  describe('navigateMatch', () => {
    it('navigates forward through matches', () => {
      searchConversation(container, 'test', { caseSensitive: false, regex: false })
      const highlights = getHighlights()
      expect(highlights).toHaveLength(3)

      // Initially first is active
      expect(highlights[0].classList.contains(HIGHLIGHT_ACTIVE_CLASS)).toBe(true)

      // Navigate next
      const r1 = navigateMatch(container, 'next')
      expect(r1.currentIndex).toBe(1)
      expect(highlights[1].classList.contains(HIGHLIGHT_ACTIVE_CLASS)).toBe(true)
      expect(highlights[0].classList.contains(HIGHLIGHT_ACTIVE_CLASS)).toBe(false)
    })

    it('navigates backward through matches', () => {
      searchConversation(container, 'test', { caseSensitive: false, regex: false })

      // Navigate prev from index 0 should wrap to last
      const r1 = navigateMatch(container, 'prev')
      expect(r1.currentIndex).toBe(2)
    })

    it('cycles forward from last to first', () => {
      searchConversation(container, 'test', { caseSensitive: false, regex: false })

      navigateMatch(container, 'next') // index 1
      navigateMatch(container, 'next') // index 2
      const r = navigateMatch(container, 'next') // should wrap to 0
      expect(r.currentIndex).toBe(0)
    })

    it('returns -1 when no highlights exist', () => {
      const r = navigateMatch(container, 'next')
      expect(r.currentIndex).toBe(-1)
      expect(r.totalMatches).toBe(0)
    })
  })

  describe('clearSearchHighlights', () => {
    it('removes all mark elements and restores text', () => {
      searchConversation(container, 'test', { caseSensitive: false, regex: false })
      expect(getHighlights().length).toBeGreaterThan(0)

      clearSearchHighlights(container)
      expect(getHighlights()).toHaveLength(0)

      // Original text should be restored
      const userMsg = container.querySelector('[data-testid="message-user"]')
      expect(userMsg?.textContent).toBe('Hello world, this is a test message')
    })

    it('is safe to call when no highlights exist', () => {
      expect(() => clearSearchHighlights(container)).not.toThrow()
    })
  })
})
