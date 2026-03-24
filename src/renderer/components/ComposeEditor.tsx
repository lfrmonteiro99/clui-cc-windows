import React, { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, PaperPlaneRight } from '@phosphor-icons/react'
import { useColors } from '../theme'

interface ComposeEditorProps {
  isOpen: boolean
  initialText: string
  onSubmit: (text: string) => void
  onCancel: (draft: string) => void
  disabled?: boolean
}

/**
 * Full-height compose editor overlay for drafting complex, multi-paragraph prompts.
 * Opens via Ctrl+G (Windows) / Cmd+G (macOS).
 *
 * - Monospaced textarea with line numbers
 * - Top bar: title, char/line counts, Cancel (Esc) + Submit (Ctrl+Enter)
 * - Framer Motion slide-up animation
 * - All colors from useColors() hook
 */
export function ComposeEditor({ isOpen, initialText, onSubmit, onCancel, disabled }: ComposeEditorProps) {
  const colors = useColors()
  const [text, setText] = useState(initialText)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hasInitialized = useRef(false)

  // Sync initial text when editor opens
  useEffect(() => {
    if (isOpen) {
      setText(initialText)
      hasInitialized.current = true
      // Focus textarea after animation frame
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (el) {
          el.focus()
          // Place cursor at end
          el.selectionStart = el.value.length
          el.selectionEnd = el.value.length
        }
      })
    }
  }, [isOpen, initialText])

  const handleSubmit = useCallback(() => {
    if (disabled) return
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }, [text, onSubmit, disabled])

  const handleCancel = useCallback(() => {
    onCancel(text)
  }, [text, onCancel])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
      return
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSubmit()
      return
    }
  }, [handleCancel, handleSubmit])

  const lineCount = text.split('\n').length
  const charCount = text.length

  // Generate line number gutter text
  const lineNumbers = Array.from({ length: Math.max(lineCount, 1) }, (_, i) => i + 1)

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="compose-editor"
          data-testid="compose-editor"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            background: colors.containerBg,
            borderRadius: 12,
            border: `1px solid ${colors.containerBorder}`,
            overflow: 'hidden',
          }}
        >
          {/* Top bar */}
          <div
            data-testid="compose-top-bar"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderBottom: `1px solid ${colors.containerBorder}`,
              background: colors.surfacePrimary,
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: colors.textPrimary,
              }}
            >
              Compose Prompt
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Char / line count */}
              <span
                data-testid="compose-counts"
                style={{
                  fontSize: 11,
                  color: colors.textTertiary,
                  fontFamily: 'monospace',
                }}
              >
                {charCount} char{charCount !== 1 ? 's' : ''} · {lineCount} line{lineCount !== 1 ? 's' : ''}
              </span>

              {/* Cancel button */}
              <button
                data-testid="compose-cancel"
                onClick={handleCancel}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: `1px solid ${colors.containerBorder}`,
                  background: 'transparent',
                  color: colors.textSecondary,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
                title="Cancel (Esc)"
              >
                <X size={14} />
                <span>Esc</span>
              </button>

              {/* Submit button */}
              <button
                data-testid="compose-submit"
                onClick={handleSubmit}
                disabled={disabled || text.trim().length === 0}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: disabled || text.trim().length === 0
                    ? colors.sendDisabled
                    : colors.sendBg,
                  color: colors.textOnAccent,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: disabled || text.trim().length === 0 ? 'not-allowed' : 'pointer',
                }}
                title="Submit (Ctrl+Enter)"
              >
                <PaperPlaneRight size={14} />
                <span>Ctrl+Enter</span>
              </button>
            </div>
          </div>

          {/* Editor area with line numbers */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            {/* Line number gutter */}
            <div
              data-testid="compose-line-numbers"
              style={{
                padding: '12px 0',
                paddingRight: 8,
                paddingLeft: 12,
                textAlign: 'right',
                fontFamily: 'monospace',
                fontSize: 13,
                lineHeight: '20px',
                color: colors.textTertiary,
                userSelect: 'none',
                flexShrink: 0,
                overflow: 'hidden',
                borderRight: `1px solid ${colors.containerBorder}`,
                background: colors.surfacePrimary,
              }}
            >
              {lineNumbers.map((n) => (
                <div key={n}>{n}</div>
              ))}
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              data-testid="compose-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              style={{
                flex: 1,
                padding: '12px 16px',
                background: 'transparent',
                color: colors.textPrimary,
                fontFamily: 'monospace',
                fontSize: 13,
                lineHeight: '20px',
                border: 'none',
                outline: 'none',
                resize: 'none',
                overflow: 'auto',
              }}
              placeholder="Write your prompt here..."
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
