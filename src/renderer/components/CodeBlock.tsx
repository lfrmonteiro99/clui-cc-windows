import React, { useState, useEffect, useMemo } from 'react'
import { Copy, Check, ArrowsOutSimple } from '@phosphor-icons/react'
import { useColors, useThemeStore } from '../theme'
import { highlightCode } from '../utils/shiki'

/** Threshold: show line numbers only when code exceeds this many lines */
const LINE_NUMBER_THRESHOLD = 10

/** Threshold: apply max-height and show expand button when code exceeds this many lines */
const MAX_HEIGHT_THRESHOLD = 20

/** Max height in pixels before scroll + expand button */
const MAX_HEIGHT_PX = 400

/** Copy button scoped to code blocks — always visible, larger touch target. */
function CopyCodeButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const colors = useColors()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.warn('[CodeBlock] clipboard write failed:', err)
    }
  }

  return (
    <button
      data-testid="codeblock-copy-btn"
      onClick={handleCopy}
      className="inline-flex items-center justify-center gap-1 rounded-md text-[11px] cursor-pointer flex-shrink-0 transition-opacity"
      style={{
        width: 28,
        height: 28,
        background: copied ? colors.statusCompleteBg : colors.surfaceHover,
        color: copied ? colors.statusComplete : colors.textTertiary,
        border: 'none',
        opacity: copied ? 1 : 0.7,
      }}
      title="Copy code"
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = copied ? colors.statusCompleteBg : colors.surfaceActive }}
      onMouseLeave={(e) => { if (!copied) { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.background = colors.surfaceHover } }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied && <span className="text-[11px]">Copied!</span>}
    </button>
  )
}

/** Line number gutter for long code blocks */
function LineNumbers({ count, colors }: { count: number; colors: ReturnType<typeof useColors> }) {
  const numbers = useMemo(
    () => Array.from({ length: count }, (_, i) => i + 1),
    [count],
  )

  return (
    <div
      data-testid="codeblock-line-numbers"
      className="flex-shrink-0 select-none text-right pr-3"
      style={{
        width: 36,
        color: colors.textMuted,
        fontSize: 12,
        lineHeight: 1.6,
      }}
      aria-hidden="true"
    >
      {numbers.map((n) => (
        <span key={n} className="block">{n}</span>
      ))}
    </div>
  )
}

/**
 * Syntax-highlighted code block using shiki.
 *
 * Premium features:
 * - Redesigned header with surfaceHover bg, font-medium language label
 * - Always-visible copy button with feedback animation
 * - Line numbers for blocks >10 lines
 * - Max height 400px with expand button for long blocks
 * - 12px font, 1.6 line-height for readability
 */
export function CodeBlock({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const isDark = useThemeStore((s) => s.isDark)
  const colors = useColors()

  const lineCount = useMemo(() => code.split('\n').length, [code])
  const showLineNumbers = lineCount > LINE_NUMBER_THRESHOLD
  const showMaxHeight = lineCount > MAX_HEIGHT_THRESHOLD && !expanded

  useEffect(() => {
    let cancelled = false
    setHtml(null)

    highlightCode(code, language || 'plaintext', isDark)
      .then((result) => {
        if (!cancelled) setHtml(result)
      })
      .catch((err) => {
        console.warn('[CodeBlock] shiki highlight failed:', err)
      })

    return () => {
      cancelled = true
    }
  }, [code, language, isDark])

  return (
    <div
      className="relative rounded-lg overflow-hidden my-2"
      style={{
        background: colors.codeBg,
        border: `1px solid ${colors.containerBorder}`,
      }}
    >
      {/* Header: language label + copy button */}
      <div
        data-testid="codeblock-header"
        className="flex justify-between items-center text-[11px] font-medium"
        style={{
          padding: '10px 14px',
          color: colors.textTertiary,
          background: colors.surfaceHover,
          borderBottom: `1px solid ${colors.containerBorder}`,
        }}
      >
        <span>{language || 'text'}</span>
        <CopyCodeButton text={code} />
      </div>

      {/* Code content */}
      <div
        data-testid="codeblock-code-area"
        className="overflow-auto"
        style={{
          padding: '16px 14px',
          maxHeight: showMaxHeight ? `${MAX_HEIGHT_PX}px` : undefined,
        }}
      >
        <div className={`flex ${showLineNumbers ? 'flex-row' : ''}`}>
          {showLineNumbers && <LineNumbers count={lineCount} colors={colors} />}

          <div className="flex-1 min-w-0 overflow-x-auto text-[12px] font-mono" style={{ lineHeight: 1.6 }}>
            {html ? (
              <div
                data-testid="codeblock-highlighted"
                className="[&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_code]:!bg-transparent [&_code]:!p-0"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <pre className="m-0 p-0 bg-transparent">
                <code className="bg-transparent p-0" style={{ color: colors.textPrimary }}>
                  {code}
                </code>
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* Expand button for long blocks */}
      {lineCount > MAX_HEIGHT_THRESHOLD && !expanded && (
        <button
          data-testid="codeblock-expand-btn"
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center justify-center gap-1 w-full py-1.5 text-[11px] cursor-pointer transition-colors"
          style={{
            background: colors.surfaceHover,
            color: colors.textTertiary,
            border: 'none',
            borderTop: `1px solid ${colors.containerBorder}`,
          }}
        >
          <ArrowsOutSimple size={12} />
          Expand
        </button>
      )}
    </div>
  )
}
