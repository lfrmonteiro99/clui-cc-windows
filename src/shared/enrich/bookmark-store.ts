/**
 * ENRICH-007: Bookmarks & Smart Scroll
 *
 * A lightweight bookmark store that persists to localStorage.
 * Each bookmark ties a message ID to a tab ID.
 */

import type { Message } from '../types'

export interface Bookmark {
  id: string
  tabId: string
  messageId: string
  label: string
  createdAt: number
}

const STORAGE_KEY = 'clui-bookmarks'
const MAX_BOOKMARKS = 100

export class BookmarkStore {
  private bookmarks: Bookmark[] = []

  constructor() {
    this.load()
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        this.bookmarks = JSON.parse(raw)
      }
    } catch (err) {
      console.warn('[BookmarkStore] load failed:', err)
      this.bookmarks = []
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bookmarks))
    } catch (err) {
      console.warn('[BookmarkStore] persist failed:', err)
    }
  }

  add(tabId: string, messageId: string, label: string): Bookmark {
    const bookmark: Bookmark = {
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tabId,
      messageId,
      label,
      createdAt: Date.now(),
    }
    this.bookmarks.push(bookmark)

    // Purge oldest if over limit
    if (this.bookmarks.length > MAX_BOOKMARKS) {
      this.bookmarks = this.bookmarks
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MAX_BOOKMARKS)
    }

    this.persist()
    return bookmark
  }

  remove(bookmarkId: string): void {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== bookmarkId)
    this.persist()
  }

  getForTab(tabId: string): Bookmark[] {
    return this.bookmarks.filter((b) => b.tabId === tabId)
  }

  getAll(): Bookmark[] {
    return [...this.bookmarks]
  }

  isBookmarked(messageId: string): boolean {
    return this.bookmarks.some((b) => b.messageId === messageId)
  }

  clearBookmarksForTab(tabId: string): void {
    this.bookmarks = this.bookmarks.filter((b) => b.tabId !== tabId)
    this.persist()
  }

  clear(): void {
    this.bookmarks = []
    this.persist()
  }
}

/**
 * Find the last assistant message that contains a code block.
 */
export function findLastCodeMessage(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue
    const text = msg._textChunks ? msg._textChunks.join('') : msg.content
    if (text && /```/.test(text)) {
      return msg
    }
  }
  return null
}
