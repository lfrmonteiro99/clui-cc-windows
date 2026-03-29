// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { useBookmarkStore } from '../../src/renderer/stores/bookmarkStore'

describe('BookmarkStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useBookmarkStore.setState({ bookmarks: [] })
  })

  it('starts with no bookmarks', () => {
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(0)
  })

  it('addBookmark adds correctly', () => {
    useBookmarkStore.getState().addBookmark('msg-1', 'tab-1', 'Test message content')
    const bookmarks = useBookmarkStore.getState().bookmarks
    expect(bookmarks).toHaveLength(1)
    expect(bookmarks[0].messageId).toBe('msg-1')
    expect(bookmarks[0].tabId).toBe('tab-1')
    expect(bookmarks[0].label).toBe('Test message content')
  })

  it('addBookmark does not add duplicates', () => {
    useBookmarkStore.getState().addBookmark('msg-1', 'tab-1', 'Label')
    useBookmarkStore.getState().addBookmark('msg-1', 'tab-1', 'Label again')
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(1)
  })

  it('addBookmark truncates label to 60 chars', () => {
    const longLabel = 'A'.repeat(100)
    useBookmarkStore.getState().addBookmark('msg-1', 'tab-1', longLabel)
    expect(useBookmarkStore.getState().bookmarks[0].label).toHaveLength(60)
  })

  it('removeBookmark removes by id', () => {
    useBookmarkStore.getState().addBookmark('msg-1', 'tab-1', 'Label')
    const bookmark = useBookmarkStore.getState().bookmarks[0]
    useBookmarkStore.getState().removeBookmark(bookmark.id)
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(0)
  })

  it('getBookmarksForTab filters by tab', () => {
    useBookmarkStore.getState().addBookmark('msg-1', 'tab-1', 'Tab 1 message')
    useBookmarkStore.getState().addBookmark('msg-2', 'tab-2', 'Tab 2 message')
    useBookmarkStore.getState().addBookmark('msg-3', 'tab-1', 'Tab 1 another')

    const tab1Bookmarks = useBookmarkStore.getState().getBookmarksForTab('tab-1')
    expect(tab1Bookmarks).toHaveLength(2)
    expect(tab1Bookmarks.every((b) => b.tabId === 'tab-1')).toBe(true)

    const tab2Bookmarks = useBookmarkStore.getState().getBookmarksForTab('tab-2')
    expect(tab2Bookmarks).toHaveLength(1)
  })

  it('isBookmarked returns correct boolean', () => {
    expect(useBookmarkStore.getState().isBookmarked('msg-1')).toBe(false)
    useBookmarkStore.getState().addBookmark('msg-1', 'tab-1', 'Label')
    expect(useBookmarkStore.getState().isBookmarked('msg-1')).toBe(true)
    expect(useBookmarkStore.getState().isBookmarked('msg-999')).toBe(false)
  })

  it('max 100 bookmarks — oldest purged', () => {
    for (let i = 0; i < 110; i++) {
      useBookmarkStore.getState().addBookmark(`msg-${i}`, 'tab-1', `Bookmark ${i}`)
    }
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(100)
    // Most recent (msg-109) should be first
    expect(useBookmarkStore.getState().bookmarks[0].messageId).toBe('msg-109')
  })

  it('clearBookmarksForTab removes only that tab', () => {
    useBookmarkStore.getState().addBookmark('msg-1', 'tab-1', 'Tab 1')
    useBookmarkStore.getState().addBookmark('msg-2', 'tab-2', 'Tab 2')
    useBookmarkStore.getState().addBookmark('msg-3', 'tab-1', 'Tab 1 again')

    useBookmarkStore.getState().clearBookmarksForTab('tab-1')
    const remaining = useBookmarkStore.getState().bookmarks
    expect(remaining).toHaveLength(1)
    expect(remaining[0].tabId).toBe('tab-2')
  })

  it('persists to localStorage', () => {
    useBookmarkStore.getState().addBookmark('msg-1', 'tab-1', 'Persisted')
    const stored = localStorage.getItem('clui-bookmarks')
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].messageId).toBe('msg-1')
  })
})
