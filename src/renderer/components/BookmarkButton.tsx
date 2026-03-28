import React, { useCallback } from 'react'
import { PushPin } from '@phosphor-icons/react'
import { useBookmarkStore } from '../stores/bookmarkStore'
import { useColors } from '../theme'

interface BookmarkButtonProps {
  messageId: string
  tabId: string
  messageContent: string
}

export const BookmarkButton = React.memo(function BookmarkButton({
  messageId,
  tabId,
  messageContent,
}: BookmarkButtonProps) {
  const colors = useColors()
  const isBookmarked = useBookmarkStore((s) => s.bookmarks.some((b) => b.messageId === messageId))

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const state = useBookmarkStore.getState()
    if (state.isBookmarked(messageId)) {
      const bookmark = state.bookmarks.find((b) => b.messageId === messageId)
      if (bookmark) state.removeBookmark(bookmark.id)
    } else {
      const label = messageContent.replace(/\s+/g, ' ').trim().slice(0, 60)
      state.addBookmark(messageId, tabId, label)
    }
  }, [messageId, tabId, messageContent])

  return (
    <button
      data-testid="bookmark-button"
      onClick={handleClick}
      className="absolute top-1 right-1 p-1 rounded-md opacity-0 group-hover/msg:opacity-100 transition-opacity duration-100 cursor-pointer z-10"
      style={{
        background: isBookmarked ? colors.accentLight : 'transparent',
        color: isBookmarked ? colors.accent : colors.textTertiary,
      }}
      title={isBookmarked ? 'Remove bookmark' : 'Bookmark this message'}
    >
      <PushPin size={14} weight={isBookmarked ? 'fill' : 'regular'} />
    </button>
  )
})
