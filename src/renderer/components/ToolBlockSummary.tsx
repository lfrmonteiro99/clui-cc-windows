import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Terminal, FileText, PencilSimple, MagnifyingGlass, Wrench,
  CaretDown, CaretRight,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { useColors } from '../theme'
import { getEnrichedToolLabel } from '../../shared/tool-enrichment'

// ─── Constants ───

const AUTO_COLLAPSE_THRESHOLD = 15
const PREVIEW_LINE_COUNT = 5

// ─── Tool type classification ───

interface ToolTypeInfo {
  iconName: string
  icon: Icon
  category: 'bash' | 'read' | 'edit' | 'search' | 'other'
}

const TOOL_TYPE_MAP: Record<string, ToolTypeInfo> = {
  Bash: { iconName: 'Terminal', icon: Terminal, category: 'bash' },
  bash: { iconName: 'Terminal', icon: Terminal, category: 'bash' },
  Read: { iconName: 'FileText', icon: FileText, category: 'read' },
  file_read: { iconName: 'FileText', icon: FileText, category: 'read' },
  Edit: { iconName: 'PencilSimple', icon: PencilSimple, category: 'edit' },
  Write: { iconName: 'PencilSimple', icon: PencilSimple, category: 'edit' },
  file_edit: { iconName: 'PencilSimple', icon: PencilSimple, category: 'edit' },
  Search: { iconName: 'MagnifyingGlass', icon: MagnifyingGlass, category: 'search' },
  Grep: { iconName: 'MagnifyingGlass', icon: MagnifyingGlass, category: 'search' },
  Glob: { iconName: 'MagnifyingGlass', icon: MagnifyingGlass, category: 'search' },
}

const DEFAULT_TOOL_TYPE: ToolTypeInfo = {
  iconName: 'Wrench',
  icon: Wrench,
  category: 'other',
}

export function getToolTypeInfo(toolName: string): ToolTypeInfo {
  return TOOL_TYPE_MAP[toolName] ?? DEFAULT_TOOL_TYPE
}

// ─── Summary generation ───

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

function safeParse(input: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(input)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function countLines(text: string): number {
  if (!text) return 0
  return text.split('\n').length
}

export function getToolSummary(
  toolName: string,
  toolInput: string | undefined,
  content: string,
): string {
  const info = getToolTypeInfo(toolName)
  const parsed = toolInput ? safeParse(toolInput) : null

  // Use enriched label as base, then append output stats where useful
  const enriched = getEnrichedToolLabel(toolName, toolInput)

  switch (info.category) {
    case 'bash': {
      const cmd = parsed?.command
      const cmdStr = typeof cmd === 'string' ? cmd.trim() : ''
      const shortCmd = cmdStr.length > 60 ? `${cmdStr.substring(0, 57)}...` : cmdStr
      // Try to extract exit code from content
      const exitMatch = content.match(/exit code[:\s]*(\d+)/i)
      const exitStr = exitMatch ? ` (exit ${exitMatch[1]})` : ''
      return shortCmd ? `$ ${shortCmd}${exitStr}` : `Bash${exitStr}`
    }
    case 'read': {
      const lines = countLines(content)
      // enriched is like "Reading `file.ts`"
      return `${enriched} (${lines} lines)`
    }
    case 'edit': {
      // enriched already includes diff stats like "Editing `file.ts` (+3 −1)"
      return enriched
    }
    case 'search': {
      const resultLines = content ? content.split('\n').filter((l) => l.trim()).length : 0
      return `${enriched} (${resultLines} results)`
    }
    default:
      return enriched !== toolName ? enriched : toolName
  }
}

// ─── Collapse logic ───

export function shouldAutoCollapse(content: string): boolean {
  if (!content) return false
  return content.split('\n').length > AUTO_COLLAPSE_THRESHOLD
}

export function getCollapsedPreviewLines(content: string): {
  previewLines: string[]
  remainingCount: number
} {
  const lines = content.split('\n')
  if (lines.length <= PREVIEW_LINE_COUNT) {
    return { previewLines: lines, remainingCount: 0 }
  }
  return {
    previewLines: lines.slice(0, PREVIEW_LINE_COUNT),
    remainingCount: lines.length - PREVIEW_LINE_COUNT,
  }
}

// ─── CollapsibleToolOutput Component ───

export interface CollapsibleToolOutputProps {
  toolName: string
  toolInput?: string
  content: string
  toolStatus?: 'running' | 'completed' | 'error'
}

export function CollapsibleToolOutput({
  toolName,
  toolInput,
  content,
  toolStatus,
}: CollapsibleToolOutputProps) {
  const colors = useColors()
  const info = getToolTypeInfo(toolName)
  const ToolIcon = info.icon

  const summary = useMemo(
    () => getToolSummary(toolName, toolInput, content),
    [toolName, toolInput, content],
  )

  const autoCollapse = useMemo(() => shouldAutoCollapse(content), [content])
  const [collapsed, setCollapsed] = useState(autoCollapse)

  const preview = useMemo(
    () => (collapsed ? getCollapsedPreviewLines(content) : null),
    [collapsed, content],
  )

  const isError = toolStatus === 'error'

  return (
    <div
      className="rounded-md overflow-hidden text-[12px] mt-1"
      style={{
        background: colors.codeBg,
        border: `1px solid ${isError ? colors.statusError : colors.toolBorder}`,
      }}
    >
      {/* Header: icon + summary */}
      <div
        data-testid="tool-block-header"
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none"
        style={{
          background: colors.surfaceHover,
          borderBottom: `1px solid ${colors.toolBorder}`,
          color: isError ? colors.statusError : colors.textSecondary,
        }}
        onClick={() => {
          if (autoCollapse) setCollapsed((prev) => !prev)
        }}
      >
        <ToolIcon size={12} />
        <span className="truncate flex-1">{summary}</span>
        {autoCollapse && (
          collapsed
            ? <CaretRight size={10} style={{ color: colors.textMuted }} />
            : <CaretDown size={10} style={{ color: colors.textMuted }} />
        )}
      </div>

      {/* Content area */}
      {collapsed && preview ? (
        <div className="px-2 py-1.5">
          <pre
            data-testid="tool-output-preview"
            className="whitespace-pre-wrap break-all text-[11px] leading-[1.5] font-mono"
            style={{ color: colors.textTertiary }}
          >
            {preview.previewLines.join('\n')}
          </pre>
          {preview.remainingCount > 0 && (
            <button
              data-testid="show-more-btn"
              type="button"
              className="mt-1 text-[11px] cursor-pointer rounded px-1.5 py-0.5 transition-colors"
              style={{
                color: colors.accent,
                background: 'transparent',
                border: 'none',
              }}
              onClick={() => setCollapsed(false)}
            >
              Show {preview.remainingCount} more lines
            </button>
          )}
        </div>
      ) : (
        <AnimatePresence initial={false}>
          <motion.div
            key="full"
            initial={autoCollapse ? { opacity: 0, height: 0 } : false}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="px-2 py-1.5"
          >
            <pre
              data-testid="tool-output-full"
              className="whitespace-pre-wrap break-all text-[11px] leading-[1.5] font-mono"
              style={{ color: colors.textTertiary }}
            >
              {content}
            </pre>
            {autoCollapse && (
              <button
                data-testid="show-less-btn"
                type="button"
                className="mt-1 text-[11px] cursor-pointer rounded px-1.5 py-0.5 transition-colors"
                style={{
                  color: colors.accent,
                  background: 'transparent',
                  border: 'none',
                }}
                onClick={() => setCollapsed(true)}
              >
                Show less
              </button>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  )
}
