import React, { useCallback, useState, useRef, useEffect } from 'react'
import { useColors } from '../theme'
import { useFilePeekStore } from '../stores/filePeekStore'
import { useContextMenuStore } from '../stores/contextMenuStore'
import { useSessionStore } from '../stores/sessionStore'

/** Duration in ms to show the "Copied!" tooltip */
const COPIED_FEEDBACK_MS = 1500

interface FilePathProps {
  path: string
  displayName?: string
  className?: string
  style?: React.CSSProperties
}

export function FilePath({ path, displayName, className, style }: FilePathProps) {
  const colors = useColors()
  const openPeek = useFilePeekStore((s) => s.openPeek)
  const openMenu = useContextMenuStore((s) => s.openMenu)
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const getActiveTab = useCallback(() => {
    const state = useSessionStore.getState()
    return state.tabs.find((t) => t.id === state.activeTabId)
  }, [])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()

      // Ctrl+Click or Cmd+Click → open file peek (existing behavior)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const tab = getActiveTab()
        openPeek(path, tab?.workingDirectory || '', tab?.runtime, tab?.wslDistro ?? undefined)
        return
      }

      // Plain click → copy path to clipboard
      navigator.clipboard.writeText(path).then(
        () => {
          setCopied(true)
          if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
          copiedTimerRef.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
        },
        (err) => {
          console.warn('[FilePath] Failed to copy path to clipboard:', err)
        },
      )
    },
    [path, openPeek, getActiveTab],
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const tab = getActiveTab()
      openMenu({ x: e.clientX, y: e.clientY }, path, tab?.workingDirectory || '', tab?.runtime, tab?.wslDistro ?? undefined)
    },
    [path, openMenu, getActiveTab],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        const tab = getActiveTab()
        openPeek(path, tab?.workingDirectory || '', tab?.runtime, tab?.wslDistro ?? undefined)
      }
    },
    [path, openPeek, getActiveTab],
  )

  return (
    <span className="relative inline-flex items-center">
      <span
        role="button"
        tabIndex={0}
        title={path}
        aria-label={`Peek file ${path}`}
        data-clui-ui
        className={`font-mono${className ? ` ${className}` : ''}`}
        style={{
          cursor: 'pointer',
          textDecoration: 'none',
          color: colors.accent,
          borderBottom: `1px dashed ${colors.textTertiary}`,
          transition: 'color 0.15s, border-color 0.15s',
          ...style,
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget
          el.style.color = colors.accent
          el.style.borderBottomColor = colors.accent
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget
          el.style.color = colors.accent
          el.style.borderBottomColor = colors.textTertiary
        }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
      >
        {displayName || path}
      </span>
      {copied && (
        <span
          data-testid="file-path-copied-tooltip"
          className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded pointer-events-none z-50"
          style={{
            background: colors.statusCompleteBg,
            color: colors.statusComplete,
            border: `1px solid ${colors.statusComplete}`,
          }}
        >
          Copied!
        </span>
      )}
    </span>
  )
}
