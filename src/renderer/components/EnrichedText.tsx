import React, { useMemo } from 'react'
import { useColors } from '../theme'
import { FilePath } from './FilePath'
import { detectReferences } from '../../shared/reference-detect'
import type { Reference } from '../../shared/reference-detect'

interface EnrichedTextProps {
  text: string
}

/** Renders a text string with detected references made interactive. */
export function EnrichedText({ text }: EnrichedTextProps) {
  const colors = useColors()
  const refs = useMemo(() => detectReferences(text), [text])

  if (refs.length === 0) return <>{text}</>

  const parts: React.ReactNode[] = []
  let cursor = 0

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]
    // Add plain text before this reference
    if (ref.start > cursor) {
      parts.push(text.slice(cursor, ref.start))
    }
    parts.push(<ReferenceSpan key={i} ref_={ref} colors={colors} />)
    cursor = ref.end
  }

  // Add trailing text
  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return <>{parts}</>
}

// ─── Individual Reference Renderers ───

interface ReferenceSpanProps {
  ref_: Reference
  colors: ReturnType<typeof useColors>
}

function ReferenceSpan({ ref_, colors }: ReferenceSpanProps) {
  switch (ref_.type) {
    case 'url':
      return (
        <span
          role="link"
          tabIndex={0}
          className="cursor-pointer underline decoration-dotted underline-offset-2"
          style={{ color: colors.accent }}
          onClick={() => window.clui.openExternal(ref_.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') window.clui.openExternal(ref_.value)
          }}
          title={ref_.value}
        >
          {ref_.text}
        </span>
      )

    case 'filepath':
      return <FilePath path={ref_.value} displayName={ref_.text} />

    case 'github-ref': {
      const url = ref_.value.startsWith('http')
        ? ref_.value
        : `https://github.com/search?q=${encodeURIComponent(ref_.text)}&type=issues`
      return (
        <span
          role="link"
          tabIndex={0}
          className="cursor-pointer underline decoration-dotted underline-offset-2 font-mono"
          style={{ color: colors.accent }}
          onClick={() => window.clui.openExternal(url)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') window.clui.openExternal(url)
          }}
          title={`Open ${ref_.text} on GitHub`}
        >
          {ref_.text}
        </span>
      )
    }

    case 'color':
      return (
        <span className="inline-flex items-center gap-1">
          <span
            data-testid="color-swatch"
            className="inline-block rounded-sm"
            style={{
              width: 8,
              height: 8,
              backgroundColor: ref_.value,
              border: `1px solid ${colors.borderSubtle}`,
              verticalAlign: 'middle',
            }}
            title={ref_.value}
          />
          <span style={{ color: colors.textSecondary }}>{ref_.text}</span>
        </span>
      )

    default:
      return <>{ref_.text}</>
  }
}
