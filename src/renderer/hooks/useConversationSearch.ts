/**
 * Conversation-scoped search engine.
 *
 * Searches text only within message elements (data-testid starting with "message-"),
 * skipping UI chrome (data-clui-ui). Uses TreeWalker to find text nodes, wraps matches
 * in <mark> elements with themed CSS classes.
 */
import { useState, useCallback, useRef } from 'react'

// ─── Constants ───

export const HIGHLIGHT_CLASS = 'search-highlight'
export const HIGHLIGHT_ACTIVE_CLASS = 'search-highlight-active'

/** Selects all message containers that should be searchable */
const MESSAGE_SELECTOR = [
  '[data-testid="message-user"]',
  '[data-testid="message-assistant"]',
  '[data-testid="message-system"]',
  '[data-testid="message-system-error"]',
].join(',')

// ─── Types ───

export interface SearchOptions {
  caseSensitive: boolean
  regex: boolean
}

export interface SearchResult {
  totalMatches: number
  currentIndex: number
}

// ─── Internal state tracking (module-level for navigate) ───

let currentMatchIndex = -1

// ─── Pure search functions (exported for testing) ───

/**
 * Clear all existing search highlights, restoring original text nodes.
 */
export function clearSearchHighlights(container: HTMLElement): void {
  const marks = container.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`)
  marks.forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    const textNode = document.createTextNode(mark.textContent || '')
    parent.replaceChild(textNode, mark)
    // Merge adjacent text nodes
    parent.normalize()
  })
  currentMatchIndex = -1
}

/**
 * Search conversation messages within the container.
 * Clears previous highlights and creates new ones.
 */
export function searchConversation(
  container: HTMLElement,
  query: string,
  options: SearchOptions,
): SearchResult {
  // Always clear previous search
  clearSearchHighlights(container)

  if (!query.trim()) {
    return { totalMatches: 0, currentIndex: -1 }
  }

  // Build the regex for matching
  let searchRegex: RegExp
  try {
    const pattern = options.regex ? query : escapeRegex(query)
    const flags = options.caseSensitive ? 'g' : 'gi'
    searchRegex = new RegExp(pattern, flags)
  } catch (err) {
    console.warn('[ConversationSearch] Invalid regex:', err)
    return { totalMatches: 0, currentIndex: -1 }
  }

  // Find all message elements
  const messageElements = container.querySelectorAll(MESSAGE_SELECTOR)
  let totalMatches = 0

  messageElements.forEach((msgEl) => {
    // Skip if inside a data-clui-ui ancestor
    if (msgEl.closest('[data-clui-ui]')) return

    totalMatches += highlightTextNodes(msgEl as HTMLElement, searchRegex)
  })

  // Set first match as active
  if (totalMatches > 0) {
    currentMatchIndex = 0
    setActiveHighlight(container, 0)
  } else {
    currentMatchIndex = -1
  }

  return { totalMatches, currentIndex: currentMatchIndex }
}

/**
 * Navigate to next or previous match.
 */
export function navigateMatch(
  container: HTMLElement,
  direction: 'next' | 'prev',
): SearchResult {
  const highlights = container.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`)
  const total = highlights.length

  if (total === 0) {
    return { totalMatches: 0, currentIndex: -1 }
  }

  // Remove active class from current
  highlights.forEach((el) => el.classList.remove(HIGHLIGHT_ACTIVE_CLASS))

  if (direction === 'next') {
    currentMatchIndex = (currentMatchIndex + 1) % total
  } else {
    currentMatchIndex = (currentMatchIndex - 1 + total) % total
  }

  setActiveHighlight(container, currentMatchIndex)

  return { totalMatches: total, currentIndex: currentMatchIndex }
}

// ─── Internal helpers ───

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Walk text nodes within an element and wrap regex matches in <mark> tags.
 * Returns the number of matches found.
 */
function highlightTextNodes(element: HTMLElement, regex: RegExp): number {
  let matchCount = 0
  const textNodes: Text[] = []

  // Collect text nodes first (modifying DOM during traversal is unsafe)
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // Skip if inside a mark we already created (shouldn't happen after clear, but safety)
      if (node.parentElement?.classList.contains(HIGHLIGHT_CLASS)) {
        return NodeFilter.FILTER_SKIP
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let node = walker.nextNode()
  while (node) {
    textNodes.push(node as Text)
    node = walker.nextNode()
  }

  // Process each text node
  for (const textNode of textNodes) {
    const text = textNode.textContent || ''
    if (!text) continue

    // Reset regex lastIndex for each text node
    regex.lastIndex = 0

    const matches: Array<{ start: number; end: number }> = []
    let match: RegExpExecArray | null

    while ((match = regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        // Prevent infinite loop on zero-length matches
        regex.lastIndex++
        continue
      }
      matches.push({ start: match.index, end: match.index + match[0].length })
    }

    if (matches.length === 0) continue

    matchCount += matches.length

    // Build replacement nodes
    const fragment = document.createDocumentFragment()
    let lastEnd = 0

    for (const m of matches) {
      // Text before match
      if (m.start > lastEnd) {
        fragment.appendChild(document.createTextNode(text.slice(lastEnd, m.start)))
      }

      // The match wrapped in <mark>
      const mark = document.createElement('mark')
      mark.className = HIGHLIGHT_CLASS
      mark.textContent = text.slice(m.start, m.end)
      fragment.appendChild(mark)

      lastEnd = m.end
    }

    // Text after last match
    if (lastEnd < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastEnd)))
    }

    // Replace the original text node
    textNode.parentNode?.replaceChild(fragment, textNode)
  }

  return matchCount
}

function setActiveHighlight(container: HTMLElement, index: number): void {
  const highlights = container.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`)
  // Remove existing active
  highlights.forEach((el) => el.classList.remove(HIGHLIGHT_ACTIVE_CLASS))

  if (index >= 0 && index < highlights.length) {
    highlights[index].classList.add(HIGHLIGHT_ACTIVE_CLASS)
    highlights[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

// ─── React Hook ───

export interface UseConversationSearchReturn {
  searchOpen: boolean
  resultIndex: number
  resultCount: number
  openSearch: () => void
  closeSearch: () => void
  handleSearch: (term: string, options: SearchOptions) => { resultIndex: number; resultCount: number }
  handleNext: (term: string, options: SearchOptions) => { resultIndex: number; resultCount: number }
  handlePrev: (term: string, options: SearchOptions) => { resultIndex: number; resultCount: number }
}

export function useConversationSearch(containerRef: React.RefObject<HTMLElement | null>): UseConversationSearchReturn {
  const [searchOpen, setSearchOpen] = useState(false)
  const [resultIndex, setResultIndex] = useState(-1)
  const [resultCount, setResultCount] = useState(0)
  const lastTermRef = useRef('')

  const openSearch = useCallback(() => {
    setSearchOpen(true)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setResultIndex(-1)
    setResultCount(0)
    lastTermRef.current = ''
    if (containerRef.current) {
      clearSearchHighlights(containerRef.current)
    }
  }, [containerRef])

  const handleSearch = useCallback((term: string, options: SearchOptions) => {
    const container = containerRef.current
    if (!container) return { resultIndex: -1, resultCount: 0 }

    lastTermRef.current = term
    const result = searchConversation(container, term, options)
    setResultIndex(result.currentIndex)
    setResultCount(result.totalMatches)
    return { resultIndex: result.currentIndex, resultCount: result.totalMatches }
  }, [containerRef])

  const handleNext = useCallback((_term: string, _options: SearchOptions) => {
    const container = containerRef.current
    if (!container) return { resultIndex: -1, resultCount: 0 }

    const result = navigateMatch(container, 'next')
    setResultIndex(result.currentIndex)
    setResultCount(result.totalMatches)
    return { resultIndex: result.currentIndex, resultCount: result.totalMatches }
  }, [containerRef])

  const handlePrev = useCallback((_term: string, _options: SearchOptions) => {
    const container = containerRef.current
    if (!container) return { resultIndex: -1, resultCount: 0 }

    const result = navigateMatch(container, 'prev')
    setResultIndex(result.currentIndex)
    setResultCount(result.totalMatches)
    return { resultIndex: result.currentIndex, resultCount: result.totalMatches }
  }, [containerRef])

  return {
    searchOpen,
    resultIndex,
    resultCount,
    openSearch,
    closeSearch,
    handleSearch,
    handleNext,
    handlePrev,
  }
}
