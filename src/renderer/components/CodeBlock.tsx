import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Copy, Check } from '@phosphor-icons/react'
import { useColors, useThemeStore } from '../theme'
import { highlightCode } from '../utils/shiki'

/** Copy button scoped to code blocks — lighter than the message-level CopyButton. */
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
    <motion.button
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] cursor-pointer flex-shrink-0"
      style={{
        background: copied ? colors.statusCompleteBg : 'transparent',
        color: copied ? colors.statusComplete : colors.textTertiary,
        border: 'none',
      }}
      title="Copy code"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </motion.button>
  )
}

/**
 * Syntax-highlighted code block using shiki.
 *
 * Renders plain text immediately, then swaps in highlighted HTML once shiki resolves.
 * Handles theme changes reactively via useThemeStore.
 */
export function CodeBlock({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const isDark = useThemeStore((s) => s.isDark)
  const colors = useColors()

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
      className="relative group/code rounded-lg overflow-hidden my-2"
      style={{
        background: colors.codeBg,
        border: `1px solid ${colors.containerBorder}`,
      }}
    >
      {/* Header: language label + copy button */}
      <div
        className="flex justify-between items-center px-3 py-1.5 text-[11px]"
        style={{
          color: colors.textTertiary,
          borderBottom: `1px solid ${colors.containerBorder}`,
        }}
      >
        <span>{language || 'text'}</span>
        <CopyCodeButton text={code} />
      </div>

      {/* Code content */}
      <div className="overflow-x-auto px-3 py-2 text-[12px] leading-[1.5]">
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
  )
}
