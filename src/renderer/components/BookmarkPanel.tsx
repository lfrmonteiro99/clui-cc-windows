import React, { useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BookmarkSimple, X, Trash } from '@phosphor-icons/react'
import { useBookmarkStore, type Bookmark } from '../stores/bookmarkStore'
import { useColors } from '../theme'

interface BookmarkPanelProps {
  tabId: string
  open: boolean
  onClose: () => void
  onScrollToMessage: (messageId: string) => void
}

export const BookmarkPanel = React.memo(function BookmarkPanel({
  tabId,
  open,
  onClose,
  onScrollToMessage,
}: BookmarkPanelProps) {
  const colors = useColors()
  const allBookmarks = useBookmarkStore((s) => s.bookmarks)
  const bookmarks = useMemo(() => allBookmarks.filter((b) => b.tabId === tabId), [allBookmarks, tabId])
  const removeBookmark = useBookmarkStore((s) => s.removeBookmark)
  const clearBookmarksForTab = useBookmarkStore((s) => s.clearBookmarksForTab)

  const handleBookmarkClick = useCallback((bookmark: Bookmark) => {
    onScrollToMessage(bookmark.messageId)
  }, [onScrollToMessage])

  const handleDelete = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    removeBookmark(id)
  }, [removeBookmark])

  const handleClearAll = useCallback(() => {
    clearBookmarksForTab(tabId)
  }, [clearBookmarksForTab, tabId])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="bookmark-panel"
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="absolute top-0 right-0 bottom-0 z-20 flex flex-col overflow-hidden"
          style={{
            width: 260,
            background: colors.popoverBg,
            border: `1px solid ${colors.popoverBorder}`,
            borderRadius: 12,
            boxShadow: colors.popoverShadow,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-3 py-2 flex-shrink-0"
            style={{ borderBottom: `1px solid ${colors.containerBorder}` }}
          >
            <div className="flex items-center gap-1.5">
              <BookmarkSimple size={14} weight="fill" style={{ color: colors.accent }} />
              <span className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                Bookmarks
              </span>
              {bookmarks.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: colors.accentLight, color: colors.accent }}>
                  {bookmarks.length}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-md cursor-pointer transition-colors"
              style={{ color: colors.textTertiary }}
              title="Close bookmarks"
            >
              <X size={14} />
            </button>
          </div>

          {/* Bookmark list */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {bookmarks.length === 0 ? (
              <div
                data-testid="bookmark-empty"
                className="flex flex-col items-center justify-center py-8 text-center"
              >
                <BookmarkSimple size={24} style={{ color: colors.textTertiary, marginBottom: 8 }} />
                <span className="text-[12px]" style={{ color: colors.textTertiary }}>
                  No bookmarks yet
                </span>
                <span className="text-[11px] mt-1" style={{ color: colors.textTertiary, opacity: 0.7 }}>
                  Pin important messages to find them quickly
                </span>
              </div>
            ) : (
              <div className="space-y-1">
                {bookmarks.map((bookmark) => (
                  <button
                    key={bookmark.id}
                    data-testid="bookmark-item"
                    onClick={() => handleBookmarkClick(bookmark)}
                    className="w-full text-left px-2.5 py-2 rounded-lg flex items-start gap-2 group/bm transition-colors cursor-pointer"
                    style={{ background: 'transparent' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = colors.surfaceHover }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <PinIcon color={colors.accent} />
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-[12px] leading-[1.4] truncate"
                        style={{ color: colors.textPrimary }}
                      >
                        {bookmark.label}
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: colors.textTertiary }}>
                        {formatTimestamp(bookmark.createdAt)}
                      </div>
                    </div>
                    <button
                      data-testid="bookmark-delete"
                      onClick={(e) => handleDelete(e, bookmark.id)}
                      className="p-0.5 rounded opacity-0 group-hover/bm:opacity-100 transition-opacity cursor-pointer"
                      style={{ color: colors.statusError }}
                      title="Remove bookmark"
                    >
                      <Trash size={12} />
                    </button>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear all */}
          {bookmarks.length > 0 && (
            <div
              className="flex-shrink-0 px-3 py-2"
              style={{ borderTop: `1px solid ${colors.containerBorder}` }}
            >
              <button
                data-testid="bookmark-clear-all"
                onClick={handleClearAll}
                className="w-full text-center text-[11px] py-1.5 rounded-md cursor-pointer transition-colors"
                style={{ color: colors.statusError, background: 'transparent' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = colors.statusErrorBg }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                Clear all bookmarks
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
})

function PinIcon({ color }: { color: string }) {
  return (
    <div className="flex-shrink-0 mt-0.5">
      <BookmarkSimple size={12} weight="fill" style={{ color }} />
    </div>
  )
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return d.toLocaleDateString()
}
