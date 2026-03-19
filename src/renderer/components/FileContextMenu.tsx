import React, { useEffect, useRef, useCallback } from 'react'
import { Eye, Copy, FolderOpen, ArrowSquareOut } from '@phosphor-icons/react'
import { useColors } from '../theme'
import { useContextMenuStore } from '../stores/contextMenuStore'
import { useFilePeekStore } from '../stores/filePeekStore'
import { useNotificationStore } from '../stores/notificationStore'

const ICONS: Record<string, React.ElementType> = {
  Eye,
  Copy,
  FolderOpen,
  ArrowSquareOut,
}

export function FileContextMenu() {
  const colors = useColors()
  const {
    isOpen,
    position,
    filePath,
    workingDirectory,
    items,
    focusedIndex,
    closeMenu,
    setFocusedIndex,
  } = useContextMenuStore()
  const openPeek = useFilePeekStore((s) => s.openPeek)
  const addToast = useNotificationStore((s) => s.addToast)
  const menuRef = useRef<HTMLDivElement>(null)

  const executeItem = useCallback(
    (id: string) => {
      if (!filePath || !workingDirectory) return
      closeMenu()
      switch (id) {
        case 'peek':
          openPeek(filePath, workingDirectory)
          break
        case 'copy-path':
          navigator.clipboard.writeText(filePath)
          addToast({ type: 'success', title: 'Path copied to clipboard' })
          break
        case 'reveal':
          window.clui.fileReveal(filePath, workingDirectory)
          break
        case 'open-external':
          window.clui.fileOpenExternal(filePath, workingDirectory)
          break
      }
    },
    [filePath, workingDirectory, closeMenu, openPeek, addToast],
  )

  // Click-outside dismissal
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, closeMenu])

  // Keyboard navigation (capture phase)
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.stopPropagation()
          closeMenu()
          break
        case 'ArrowDown':
          e.preventDefault()
          setFocusedIndex(Math.min(focusedIndex + 1, items.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocusedIndex(Math.max(focusedIndex - 1, 0))
          break
        case 'Enter':
          if (focusedIndex >= 0) {
            e.preventDefault()
            executeItem(items[focusedIndex].id)
          }
          break
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [isOpen, focusedIndex, items, closeMenu, setFocusedIndex, executeItem])

  if (!isOpen) return null

  const menuWidth = 220
  const menuHeight = items.length * 32 + 8
  const x = Math.max(8, Math.min(position.x, window.innerWidth - menuWidth - 8))
  const y = Math.max(8, Math.min(position.y, window.innerHeight - menuHeight - 8))

  return (
    <div
      ref={menuRef}
      data-clui-ui
      className="glass-surface"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 40,
        minWidth: menuWidth,
        borderRadius: 12,
        padding: '4px 0',
        background: colors.popoverBg,
        border: `1px solid ${colors.popoverBorder}`,
        boxShadow: colors.popoverShadow,
      }}
    >
      {items.map((item, i) => {
        const Icon = ICONS[item.icon]
        return (
          <button
            key={item.id}
            data-clui-ui
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              height: 32,
              padding: '0 12px',
              fontSize: 12,
              border: 'none',
              cursor: 'pointer',
              background: i === focusedIndex ? colors.surfaceHover : 'transparent',
              color: colors.textPrimary,
            }}
            onMouseEnter={() => setFocusedIndex(i)}
            onClick={() => executeItem(item.id)}
          >
            {Icon && (
              <Icon
                size={14}
                style={{ color: colors.textTertiary, flexShrink: 0 }}
              />
            )}
            <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
            {item.shortcut && (
              <span style={{ color: colors.textTertiary, fontSize: 11 }}>
                {item.shortcut}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
