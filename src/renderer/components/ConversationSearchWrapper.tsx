/**
 * Wraps ConversationView with a conversation-scoped search bar.
 * Ctrl+F opens the search, Escape closes it.
 * Search is scoped to message content elements only (not UI chrome).
 */
import React, { useRef, useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ConversationView } from './ConversationView'
import { TerminalSearch } from './TerminalSearch'
import { useConversationSearch } from '../hooks/useConversationSearch'

export function ConversationSearchWrapper() {
  const containerRef = useRef<HTMLDivElement>(null)
  const {
    searchOpen,
    resultIndex,
    resultCount,
    openSearch,
    closeSearch,
    handleSearch,
    handleNext,
    handlePrev,
  } = useConversationSearch(containerRef)

  // Ctrl+F / Cmd+F opens search bar
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = navigator.platform.toLowerCase().includes('mac') ? e.metaKey : e.ctrlKey
      if (mod && e.key === 'f' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openSearch])

  return (
    <div ref={containerRef} className="relative">
      <ConversationView />
      <AnimatePresence>
        {searchOpen && (
          <TerminalSearch
            onSearch={handleSearch}
            onNext={handleNext}
            onPrev={handlePrev}
            onClose={closeSearch}
            resultIndex={resultIndex}
            resultCount={resultCount}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
