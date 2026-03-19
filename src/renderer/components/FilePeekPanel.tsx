import React, { useEffect, useState, useRef } from 'react'
import {
  FileText,
  X,
  Warning,
  FileX,
  Lock,
  FolderDashed,
  Prohibit,
} from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useColors, useThemeStore } from '../theme'
import { useFilePeekStore } from '../stores/filePeekStore'
import { useContextMenuStore } from '../stores/contextMenuStore'
import { highlightCode } from '../utils/shiki'

// ─── Constants (outside component for performance) ───

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const ERROR_ICONS: Record<string, React.ElementType> = {
  not_found: FileX,
  too_large: Warning,
  binary: Prohibit,
  permission_denied: Lock,
  outside_workspace: FolderDashed,
}

const ERROR_MESSAGES: Record<string, string> = {
  not_found: 'File not found',
  too_large: 'File is too large to preview',
  binary: 'Binary files cannot be previewed',
  permission_denied: 'Permission denied',
  outside_workspace: 'File is outside the workspace',
}

// ─── Component ───

export function FilePeekPanel() {
  const colors = useColors()
  const isDark = useThemeStore((s) => s.isDark)
  const {
    isOpen,
    displayPath,
    content,
    language,
    lineCount,
    truncated,
    fileSize,
    loading,
    error,
    errorType,
    closePeek,
  } = useFilePeekStore()

  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)
  const codeAreaRef = useRef<HTMLDivElement>(null)

  // Syntax highlighting (re-runs when content, language, or theme changes)
  useEffect(() => {
    if (!content || !language) {
      setHighlightedHtml(null)
      return
    }
    let cancelled = false
    highlightCode(content, language, isDark).then((html) => {
      if (!cancelled) setHighlightedHtml(html)
    }).catch(() => {
      if (!cancelled) setHighlightedHtml(null)
    })
    return () => {
      cancelled = true
    }
  }, [content, language, isDark])

  // Escape key — close peek (but not if context menu is open)
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Don't close peek if the context menu is open — let it close first
        if (useContextMenuStore.getState().isOpen) return
        e.stopPropagation()
        closePeek()
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [isOpen, closePeek])

  // Generate line numbers
  const lineNumbers = content
    ? Array.from({ length: content.split('\n').length }, (_, i) => i + 1)
    : []

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          data-clui-ui
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
          style={{
            borderRadius: 12,
            border: `1px solid ${colors.containerBorder}`,
            background: colors.containerBg,
            boxShadow: colors.cardShadow,
            overflow: 'hidden',
            marginBottom: 8,
            maxHeight: 360,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderBottom: `1px solid ${colors.containerBorder}`,
              minHeight: 36,
            }}
          >
            <FileText
              size={14}
              style={{ color: colors.accent, flexShrink: 0 }}
            />
            <span
              style={{
                flex: 1,
                fontSize: 12,
                fontWeight: 500,
                color: colors.textPrimary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={displayPath || ''}
            >
              {displayPath || ''}
            </span>

            {/* Metadata badges */}
            {!loading && !error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                {language && (
                  <span
                    style={{
                      fontSize: 10,
                      color: colors.textTertiary,
                      background: colors.surfaceHover,
                      padding: '1px 6px',
                      borderRadius: 4,
                    }}
                  >
                    {language}
                  </span>
                )}
                {lineCount > 0 && (
                  <span style={{ fontSize: 10, color: colors.textTertiary }}>
                    {lineCount} lines
                  </span>
                )}
                {fileSize > 0 && (
                  <span style={{ fontSize: 10, color: colors.textTertiary }}>
                    {formatSize(fileSize)}
                  </span>
                )}
              </div>
            )}

            {/* Close button */}
            <button
              data-clui-ui
              onClick={closePeek}
              aria-label="Close peek panel"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                borderRadius: 4,
                border: 'none',
                background: 'transparent',
                color: colors.textTertiary,
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = colors.surfaceHover
                e.currentTarget.style.color = colors.textPrimary
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = colors.textTertiary
              }}
            >
              <X size={12} />
            </button>
          </div>

          {/* Body */}
          {loading && (
            <div style={{ padding: 12 }}>
              <div
                className="animate-pulse"
                style={{
                  height: 12,
                  width: '80%',
                  borderRadius: 4,
                  background: colors.surfaceSecondary,
                  marginBottom: 8,
                }}
              />
              <div
                className="animate-pulse"
                style={{
                  height: 12,
                  width: '60%',
                  borderRadius: 4,
                  background: colors.surfaceSecondary,
                  marginBottom: 8,
                }}
              />
              <div
                className="animate-pulse"
                style={{
                  height: 12,
                  width: '70%',
                  borderRadius: 4,
                  background: colors.surfaceSecondary,
                }}
              />
            </div>
          )}

          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '16px 12px',
                color: colors.statusError,
              }}
            >
              {(() => {
                const Icon = errorType ? ERROR_ICONS[errorType] || Warning : Warning
                return <Icon size={16} style={{ flexShrink: 0 }} />
              })()}
              <span style={{ fontSize: 12 }}>
                {errorType ? ERROR_MESSAGES[errorType] || error : error}
              </span>
            </div>
          )}

          {!loading && !error && content !== null && (
            <div
              ref={codeAreaRef}
              style={{
                overflow: 'auto',
                flex: 1,
                background: colors.codeBg,
                fontSize: 12,
                lineHeight: '20px',
              }}
            >
              <div style={{ display: 'flex', minWidth: 'fit-content' }}>
                {/* Line number gutter */}
                <div
                  aria-hidden="true"
                  style={{
                    padding: '8px 0',
                    textAlign: 'right',
                    userSelect: 'none',
                    color: colors.textTertiary,
                    fontSize: 11,
                    lineHeight: '20px',
                    minWidth: 40,
                    paddingRight: 8,
                    paddingLeft: 8,
                    borderRight: `1px solid ${colors.containerBorder}`,
                    flexShrink: 0,
                  }}
                >
                  {lineNumbers.map((n) => (
                    <div key={n}>{n}</div>
                  ))}
                </div>

                {/* Code content */}
                <div
                  style={{
                    padding: 8,
                    flex: 1,
                    overflow: 'auto',
                  }}
                >
                  {highlightedHtml ? (
                    <div
                      className="shiki-peek"
                      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                      style={{
                        fontFamily: 'monospace',
                        whiteSpace: 'pre',
                      }}
                    />
                  ) : (
                    <pre
                      style={{
                        margin: 0,
                        fontFamily: 'monospace',
                        whiteSpace: 'pre',
                        color: colors.textPrimary,
                      }}
                    >
                      {content}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Truncation footer */}
          {truncated && !loading && !error && (
            <div
              style={{
                padding: '4px 12px',
                fontSize: 11,
                color: colors.textTertiary,
                borderTop: `1px solid ${colors.containerBorder}`,
                textAlign: 'center',
              }}
            >
              File truncated — showing first {lineCount} lines of{' '}
              {formatSize(fileSize)}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
