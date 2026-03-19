import React, { useCallback } from 'react'
import { useColors } from '../theme'
import { useFilePeekStore } from '../stores/filePeekStore'
import { useContextMenuStore } from '../stores/contextMenuStore'
import { useSessionStore } from '../stores/sessionStore'

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

  const getWorkingDirectory = useCallback(() => {
    const state = useSessionStore.getState()
    const tab = state.tabs.find((t) => t.id === state.activeTabId)
    return tab?.workingDirectory || ''
  }, [])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        openPeek(path, getWorkingDirectory())
      }
    },
    [path, openPeek, getWorkingDirectory],
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      openMenu({ x: e.clientX, y: e.clientY }, path, getWorkingDirectory())
    },
    [path, openMenu, getWorkingDirectory],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        openPeek(path, getWorkingDirectory())
      }
    },
    [path, openPeek, getWorkingDirectory],
  )

  return (
    <span
      role="button"
      tabIndex={0}
      title={path}
      aria-label={`Peek file ${path}`}
      data-clui-ui
      className={className}
      style={{
        cursor: 'pointer',
        textDecoration: 'none',
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
        el.style.color = ''
        el.style.borderBottomColor = colors.textTertiary
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
    >
      {displayName || path}
    </span>
  )
}
