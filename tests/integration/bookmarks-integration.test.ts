/**
 * ENRICH-007: Bookmarks & Smart Scroll — Integration Tests
 *
 * Tests bookmark store CRUD, limits, persistence, and findLastCodeMessage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookmarkStore, findLastCodeMessage } from '../../src/shared/enrich/bookmark-store'
import type { Message } from '../../src/shared/types'

// ── localStorage mock ──

function createLocalStorageMock() {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => { store[key] = val }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    get _store() { return store },
  }
}

let localStorageMock: ReturnType<typeof createLocalStorageMock>

// ── Tests ──

describe('ENRICH-007: Bookmarks Integration', () => {
  beforeEach(() => {
    localStorageMock = createLocalStorageMock()
    Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('add → getForTab → isBookmarked → remove flow', () => {
    const store = new BookmarkStore()

    const bm = store.add('tab-1', 'msg-1', 'Important result')
    expect(bm.tabId).toBe('tab-1')
    expect(bm.messageId).toBe('msg-1')
    expect(bm.label).toBe('Important result')

    // getForTab
    const tabBookmarks = store.getForTab('tab-1')
    expect(tabBookmarks.length).toBe(1)
    expect(tabBookmarks[0].id).toBe(bm.id)

    // isBookmarked
    expect(store.isBookmarked('msg-1')).toBe(true)
    expect(store.isBookmarked('msg-999')).toBe(false)

    // remove
    store.remove(bm.id)
    expect(store.getForTab('tab-1').length).toBe(0)
    expect(store.isBookmarked('msg-1')).toBe(false)
  })

  it('max 100 bookmarks — 101st purges oldest', () => {
    const store = new BookmarkStore()

    // Add 101 bookmarks
    for (let i = 0; i < 101; i++) {
      store.add('tab-1', `msg-${i}`, `Bookmark ${i}`)
    }

    const all = store.getAll()
    expect(all.length).toBe(100)
  })

  it('clearBookmarksForTab only clears that tab', () => {
    const store = new BookmarkStore()

    store.add('tab-1', 'msg-1', 'Tab 1 bookmark')
    store.add('tab-2', 'msg-2', 'Tab 2 bookmark')
    store.add('tab-1', 'msg-3', 'Tab 1 another')

    store.clearBookmarksForTab('tab-1')

    expect(store.getForTab('tab-1').length).toBe(0)
    expect(store.getForTab('tab-2').length).toBe(1)
  })

  it('localStorage persistence: add bookmark → recreate store → bookmarks still there', () => {
    const store1 = new BookmarkStore()
    store1.add('tab-1', 'msg-1', 'Persisted bookmark')

    // Verify it was persisted
    expect(localStorageMock.setItem).toHaveBeenCalled()

    // Create a new store instance — should load from localStorage
    const store2 = new BookmarkStore()
    const loaded = store2.getForTab('tab-1')
    expect(loaded.length).toBe(1)
    expect(loaded[0].label).toBe('Persisted bookmark')
  })

  it('findLastCodeMessage with real message arrays', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Write some code', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'Sure, here is the code:\n```typescript\nconst x = 1;\n```', timestamp: 2 },
      { id: '3', role: 'tool', content: '', toolName: 'Edit', timestamp: 3 },
      { id: '4', role: 'assistant', content: 'I made the edit. Everything looks good.', timestamp: 4 },
    ]

    const lastCode = findLastCodeMessage(messages)
    expect(lastCode).not.toBeNull()
    expect(lastCode!.id).toBe('2') // The one with the code block
  })

  it('findLastCodeMessage returns null when no code blocks', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hello', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'Hi there!', timestamp: 2 },
    ]

    expect(findLastCodeMessage(messages)).toBeNull()
  })

  it('findLastCodeMessage works with _textChunks', () => {
    const messages: Message[] = [
      { id: '1', role: 'assistant', content: '', _textChunks: ['Here is code:\n```js\nlet y = 2;\n```'], timestamp: 1 },
      { id: '2', role: 'assistant', content: 'No code here.', timestamp: 2 },
    ]

    const lastCode = findLastCodeMessage(messages)
    expect(lastCode).not.toBeNull()
    expect(lastCode!.id).toBe('1')
  })

  it('handles corrupted localStorage gracefully', () => {
    localStorageMock.getItem = vi.fn().mockReturnValue('NOT VALID JSON{{{')

    // Should not throw
    const store = new BookmarkStore()
    expect(store.getAll()).toEqual([])
  })
})
