// @vitest-environment jsdom

import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BookmarkPanel } from '../../src/renderer/components/BookmarkPanel'
import { useBookmarkStore } from '../../src/renderer/stores/bookmarkStore'

describe('BookmarkPanel', () => {
  const defaultProps = {
    tabId: 'tab-1',
    open: true,
    onClose: vi.fn(),
    onScrollToMessage: vi.fn(),
  }

  beforeEach(() => {
    localStorage.clear()
    useBookmarkStore.setState({ bookmarks: [] })
    defaultProps.onClose = vi.fn()
    defaultProps.onScrollToMessage = vi.fn()
  })

  it('renders empty state message when no bookmarks', () => {
    render(<BookmarkPanel {...defaultProps} />)
    expect(screen.getByTestId('bookmark-empty')).toBeDefined()
    expect(screen.getByText('No bookmarks yet')).toBeDefined()
  })

  it('renders bookmark list', () => {
    useBookmarkStore.getState().addBookmark('msg-1', 'tab-1', 'First bookmark')
    useBookmarkStore.getState().addBookmark('msg-2', 'tab-1', 'Second bookmark')

    render(<BookmarkPanel {...defaultProps} />)
    const items = screen.getAllByTestId('bookmark-item')
    expect(items).toHaveLength(2)
  })

  it('only shows bookmarks for the given tab', () => {
    useBookmarkStore.getState().addBookmark('msg-1', 'tab-1', 'Tab 1 bookmark')
    useBookmarkStore.getState().addBookmark('msg-2', 'tab-2', 'Tab 2 bookmark')

    render(<BookmarkPanel {...defaultProps} />)
    const items = screen.getAllByTestId('bookmark-item')
    expect(items).toHaveLength(1)
    expect(screen.getByText('Tab 1 bookmark')).toBeDefined()
  })

  it('click on bookmark calls onScrollToMessage', () => {
    useBookmarkStore.getState().addBookmark('msg-1', 'tab-1', 'Click me')

    render(<BookmarkPanel {...defaultProps} />)
    fireEvent.click(screen.getByTestId('bookmark-item'))
    expect(defaultProps.onScrollToMessage).toHaveBeenCalledWith('msg-1')
  })

  it('delete bookmark removes it', () => {
    useBookmarkStore.getState().addBookmark('msg-1', 'tab-1', 'Delete me')

    render(<BookmarkPanel {...defaultProps} />)
    fireEvent.click(screen.getByTestId('bookmark-delete'))
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(0)
  })

  it('does not render when closed', () => {
    render(<BookmarkPanel {...defaultProps} open={false} />)
    expect(screen.queryByTestId('bookmark-panel')).toBeNull()
  })
})
