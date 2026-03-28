import { create } from 'zustand'

const STORAGE_KEY = 'clui-bookmarks'
const MAX_BOOKMARKS = 100

export interface Bookmark {
  id: string
  messageId: string
  tabId: string
  label: string
  createdAt: number
}

interface BookmarkState {
  bookmarks: Bookmark[]
  addBookmark: (messageId: string, tabId: string, label: string) => void
  removeBookmark: (id: string) => void
  getBookmarksForTab: (tabId: string) => Bookmark[]
  isBookmarked: (messageId: string) => boolean
  clearBookmarksForTab: (tabId: string) => void
}

function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch (err) {
    console.warn('[bookmarkStore] Failed to load bookmarks:', err)
  }
  return []
}

function saveBookmarks(bookmarks: Bookmark[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks))
  } catch (err) {
    console.warn('[bookmarkStore] Failed to save bookmarks:', err)
  }
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  bookmarks: loadBookmarks(),

  addBookmark: (messageId: string, tabId: string, label: string) => {
    const state = get()
    // Don't add duplicate
    if (state.bookmarks.some((b) => b.messageId === messageId)) return

    const trimmedLabel = label.slice(0, 60)
    const bookmark: Bookmark = {
      id: crypto.randomUUID(),
      messageId,
      tabId,
      label: trimmedLabel,
      createdAt: Date.now(),
    }

    let next = [bookmark, ...state.bookmarks]
    // Enforce max limit — remove oldest (at end since newest is prepended)
    if (next.length > MAX_BOOKMARKS) {
      next = next.slice(0, MAX_BOOKMARKS)
    }

    set({ bookmarks: next })
    saveBookmarks(next)
  },

  removeBookmark: (id: string) => {
    const next = get().bookmarks.filter((b) => b.id !== id)
    set({ bookmarks: next })
    saveBookmarks(next)
  },

  getBookmarksForTab: (tabId: string) => {
    return get().bookmarks.filter((b) => b.tabId === tabId)
  },

  isBookmarked: (messageId: string) => {
    return get().bookmarks.some((b) => b.messageId === messageId)
  },

  clearBookmarksForTab: (tabId: string) => {
    const next = get().bookmarks.filter((b) => b.tabId !== tabId)
    set({ bookmarks: next })
    saveBookmarks(next)
  },
}))
