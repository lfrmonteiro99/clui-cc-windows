import React, { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Icon } from '@phosphor-icons/react'
import {
  FileText, PencilSimple, Terminal, MagnifyingGlass, Globe,
  ArrowSquareOut, GitBranch, Wrench, Robot, Question, FolderOpen,
  FileArrowUp, CaretRight, CaretDown, SpinnerGap,
} from '@phosphor-icons/react'
import { useColors } from '../theme'
import { FilePath } from './FilePath'
import { DiffViewer } from './DiffViewer'
import { CollapsibleToolOutput } from './ToolBlockSummary'
import type { Message } from '../../shared/types'

// ─── Icon mapping ───

const TOOL_ICON_MAP: Record<string, Icon> = {
  Read: FileText,
  Edit: PencilSimple,
  Write: FileArrowUp,
  Bash: Terminal,
  Glob: FolderOpen,
  Grep: MagnifyingGlass,
  WebSearch: Globe,
  WebFetch: ArrowSquareOut,
  Agent: Robot,
  AskUserQuestion: Question,
}

/** Git-related bash commands that should get the GitBranch icon */
const GIT_COMMANDS = ['git ', 'git-']

export function getToolIcon(toolName: string, toolInput?: string): Icon {
  if (toolName === 'Bash' && toolInput) {
    try {
      const parsed = JSON.parse(toolInput)
      const cmd = typeof parsed.command === 'string' ? parsed.command : ''
      if (GIT_COMMANDS.some((prefix) => cmd.trimStart().startsWith(prefix))) {
        return GitBranch
      }
    } catch {
      /* not JSON */
    }
  }

  return TOOL_ICON_MAP[toolName] || Wrench
}

/** Short label for a tool pill — shows full filename, avoids over-truncation */
export function getToolLabel(toolName: string, toolInput?: string): string {
  if (!toolInput) return toolName

  try {
    const parsed = JSON.parse(toolInput)

    switch (toolName) {
      case 'Read': {
        const fp = parsed.file_path || parsed.path || ''
        return fp ? basename(fp) : 'Read'
      }
      case 'Edit': {
        const fp = parsed.file_path || ''
        return fp ? basename(fp) : 'Edit'
      }
      case 'Write': {
        const fp = parsed.file_path || ''
        return fp ? basename(fp) : 'Write'
      }
      case 'Bash': {
        const cmd = typeof parsed.command === 'string' ? parsed.command : ''
        if (GIT_COMMANDS.some((p) => cmd.trimStart().startsWith(p))) {
          const words = cmd.trim().split(/\s+/)
          return words.length >= 2 ? `git ${words[1]}` : 'git'
        }
        const words = cmd.trim().split(/\s+/)
        return words[0] ? truncate(words[0], 20) : 'Bash'
      }
      case 'Glob':
        return parsed.pattern ? truncate(parsed.pattern, 24) : 'Glob'
      case 'Grep':
        return parsed.pattern ? truncate(parsed.pattern, 24) : 'Grep'
      case 'WebSearch':
        return truncate(parsed.query || parsed.search_query || 'Search', 24)
      case 'WebFetch':
        return 'Fetch'
      case 'Agent':
        return 'Agent'
      default:
        return toolName
    }
  } catch {
    return toolName
  }
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.substring(0, max - 1)}…` : str
}

/** Format duration in human-readable form */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const remainder = Math.round(s % 60)
  return remainder > 0 ? `${m}m ${remainder}s` : `${m}m`
}

/** Calculate duration between consecutive tool messages (timestamp-based) */
function getToolDuration(tool: Message, index: number, tools: Message[]): string | null {
  if (tool.toolStatus === 'running') return null

  if (index < tools.length - 1) {
    const next = tools[index + 1]
    const diff = next.timestamp - tool.timestamp
    if (diff > 0) return formatDuration(diff)
  }

  return null
}

// ─── Tool detail rendering ───

function parseToolInput(raw?: string): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function ToolDetail({ tool }: { tool: Message }) {
  const colors = useColors()
  const toolName = tool.toolName || ''
  const parsed = useMemo(() => parseToolInput(tool.toolInput), [tool.toolInput])

  if (toolName === 'Edit' && parsed) {
    const filePath = typeof parsed.file_path === 'string' ? parsed.file_path : ''
    const oldString = typeof parsed.old_string === 'string' ? parsed.old_string : ''
    const newString = typeof parsed.new_string === 'string' ? parsed.new_string : ''

    if (filePath && (oldString || newString)) {
      return (
        <div className="mt-1.5">
          <DiffViewer filePath={filePath} oldString={oldString} newString={newString} />
        </div>
      )
    }
  }

  if (toolName === 'Write' && parsed) {
    const filePath = typeof parsed.file_path === 'string' ? parsed.file_path : ''
    const content = typeof parsed.content === 'string' ? parsed.content : ''

    if (filePath && content) {
      return (
        <div className="mt-1.5">
          <DiffViewer filePath={filePath} oldString="" newString={content} />
        </div>
      )
    }
  }

  return (
    <span
      className="inline-block text-[10px] mt-0.5 px-1.5 py-[1px] rounded"
      style={{
        background: tool.toolStatus === 'error' ? colors.statusErrorBg : colors.surfaceHover,
        color: tool.toolStatus === 'error' ? colors.statusError : colors.textMuted,
      }}
    >
      Result
    </span>
  )
}

/** Description with clickable file paths */
function ToolDescriptionWithFilePath({ desc, toolInput }: { desc: string; toolInput?: string }) {
  if (!toolInput) return <>{desc}</>
  try {
    const parsed = JSON.parse(toolInput)
    const fp = parsed.file_path || parsed.path
    if (fp && desc.includes(fp)) {
      const idx = desc.indexOf(fp)
      return (
        <>
          {desc.slice(0, idx)}
          <FilePath path={fp} displayName={fp} />
          {desc.slice(idx + fp.length)}
        </>
      )
    }
  } catch {
    /* not JSON */
  }
  return <>{desc}</>
}

/** Full description */
function getToolDescription(name: string, input?: string): string {
  if (!input) return name
  try {
    const parsed = JSON.parse(input)
    switch (name) {
      case 'Read': return `Read ${parsed.file_path || parsed.path || 'file'}`
      case 'Edit': return `Edit ${parsed.file_path || 'file'}`
      case 'Write': return `Write ${parsed.file_path || 'file'}`
      case 'Glob': return `Search files: ${parsed.pattern || ''}`
      case 'Grep': return `Search: ${parsed.pattern || ''}`
      case 'Bash': {
        const cmd = parsed.command || ''
        return cmd.length > 60 ? `${cmd.substring(0, 57)}...` : cmd || 'Bash'
      }
      case 'WebSearch': return `Search: ${parsed.query || parsed.search_query || ''}`
      case 'WebFetch': return `Fetch: ${parsed.url || ''}`
      case 'Agent': return `Agent: ${(parsed.prompt || parsed.description || '').substring(0, 50)}`
      default: return name
    }
  } catch {
    const trimmed = input.trim()
    if (trimmed.length > 60) return `${name}: ${trimmed.substring(0, 57)}...`
    return trimmed ? `${name}: ${trimmed}` : name
  }
}

// ─── CSS for tool-pulse animation ───

const PULSE_CSS = `@keyframes tool-pulse{0%,100%{box-shadow:0 0 0 0 rgba(217,119,87,0.2)}50%{box-shadow:0 0 0 4px rgba(217,119,87,0.1)}}.tool-pulse{animation:tool-pulse 2s ease-in-out infinite}`

let pulseInjected = false
function injectPulseCSS(): void {
  if (pulseInjected) return
  if (typeof document === 'undefined') return
  const style = document.createElement('style')
  style.textContent = PULSE_CSS
  document.head.appendChild(style)
  pulseInjected = true
}

// ─── ToolTimeline Component ───

export interface ToolTimelineProps {
  tools: Message[]
  skipMotion?: boolean
}

export const ToolTimeline = React.memo(function ToolTimeline({ tools, skipMotion }: ToolTimelineProps) {
  const hasRunning = tools.some((t) => t.toolStatus === 'running')
  const [expanded, setExpanded] = useState(false)
  const [expandedPillId, setExpandedPillId] = useState<string | null>(null)
  const colors = useColors()

  // Inject pulse animation CSS on first render
  React.useEffect(() => { injectPulseCSS() }, [])

  const isOpen = expanded || hasRunning

  const handlePillClick = useCallback((toolId: string) => {
    setExpandedPillId((prev) => (prev === toolId ? null : toolId))
  }, [])

  const handleCollapse = useCallback(() => {
    setExpanded(false)
    setExpandedPillId(null)
  }, [])

  const handleExpand = useCallback(() => {
    setExpanded(true)
  }, [])

  if (isOpen) {
    const inner = (
      <div className="py-1" data-testid="tool-timeline">
        {/* Collapse header */}
        {!hasRunning && (
          <div
            className="flex items-center gap-1.5 cursor-pointer mb-2"
            onClick={handleCollapse}
            data-testid="tool-timeline-collapse"
          >
            <CaretDown size={12} style={{ color: colors.textMuted }} />
            <span className="text-[11px] font-medium" style={{ color: colors.textMuted }}>
              {tools.length} tool{tools.length !== 1 ? 's' : ''} used
            </span>
          </div>
        )}

        {/* Pill strip */}
        <div className="flex flex-wrap gap-1.5 mb-2" data-testid="tool-pill-strip">
          {tools.map((tool, idx) => {
            const toolName = tool.toolName || 'Tool'
            const ToolIcon = getToolIcon(toolName, tool.toolInput)
            const label = getToolLabel(toolName, tool.toolInput)
            const duration = getToolDuration(tool, idx, tools)
            const isRunning = tool.toolStatus === 'running'
            const isError = tool.toolStatus === 'error'
            const isPillExpanded = expandedPillId === tool.id

            return (
              <button
                key={tool.id}
                type="button"
                data-testid="tool-pill"
                onClick={() => handlePillClick(tool.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 rounded-full text-[11px] cursor-pointer transition-colors${isRunning ? ' tool-pulse' : ''}`}
                style={{
                  minHeight: 32,
                  background: isPillExpanded
                    ? colors.accent
                    : isRunning
                      ? colors.toolRunningBg
                      : isError
                        ? colors.statusErrorBg
                        : colors.surfaceHover,
                  border: `1px solid ${
                    isPillExpanded
                      ? colors.accent
                      : isRunning
                        ? colors.toolRunningBorder
                        : isError
                          ? colors.statusError
                          : colors.toolBorder
                  }`,
                  color: isPillExpanded
                    ? colors.textPrimary
                    : isRunning
                      ? colors.statusRunning
                      : isError
                        ? colors.statusError
                        : colors.textTertiary,
                }}
              >
                {isRunning ? (
                  <SpinnerGap size={16} className="animate-spin" />
                ) : (
                  <ToolIcon size={16} />
                )}
                <span className="truncate max-w-[140px]">{label}</span>
                {duration && (
                  <span style={{ color: colors.textMuted, fontSize: 11 }}>{duration}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Expanded detail for selected pill */}
        <AnimatePresence>
          {expandedPillId && (
            <ExpandedPillDetail
              tool={tools.find((t) => t.id === expandedPillId)}
              colors={colors}
            />
          )}
        </AnimatePresence>

        {/* Running tools: show timeline for active ones */}
        {hasRunning && (
          <div className="relative pl-6 mt-1">
            <div
              className="absolute left-[10px] top-1 bottom-1 w-px"
              style={{ background: colors.timelineLine }}
            />
            <div className="space-y-2">
              {tools.filter((t) => t.toolStatus === 'running').map((tool) => {
                const toolName = tool.toolName || 'Tool'
                const desc = getToolDescription(toolName, tool.toolInput)

                return (
                  <div key={tool.id} className="relative">
                    <div
                      className="absolute -left-6 top-[1px] w-[20px] h-[20px] rounded-full flex items-center justify-center"
                      style={{
                        background: colors.toolRunningBg,
                        border: `1px solid ${colors.toolRunningBorder}`,
                      }}
                    >
                      <SpinnerGap size={10} className="animate-spin" style={{ color: colors.statusRunning }} />
                    </div>
                    <div className="min-w-0">
                      <span
                        className="text-[12px] leading-[1.4] block truncate"
                        style={{ color: colors.textSecondary }}
                      >
                        <ToolDescriptionWithFilePath desc={desc} toolInput={tool.toolInput} />
                      </span>
                      <span className="text-[10px] mt-0.5 block" style={{ color: colors.textMuted }}>
                        running...
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )

    if (skipMotion) return inner

    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.15 }}
      >
        {inner}
      </motion.div>
    )
  }

  // ─── Collapsed state ───
  const inner = (
    <div
      className="flex items-center gap-2 cursor-pointer p-2 rounded-lg"
      onClick={handleExpand}
      data-testid="tool-timeline-collapsed"
      style={{
        background: colors.surfaceHover,
      }}
    >
      <CaretRight size={12} className="flex-shrink-0" style={{ color: colors.textTertiary }} />
      <span className="text-[11px] font-medium" style={{ color: colors.textTertiary }}>
        {tools.length} tool{tools.length !== 1 ? 's' : ''} used
      </span>
      {/* Mini icon strip in collapsed mode */}
      <span className="flex items-center gap-1 ml-0.5">
        {tools.slice(0, 6).map((tool) => {
          const ToolIcon = getToolIcon(tool.toolName || 'Tool', tool.toolInput)
          return (
            <span
              key={tool.id}
              className="flex items-center"
              style={{ color: colors.textMuted }}
            >
              <ToolIcon size={16} />
            </span>
          )
        })}
        {tools.length > 6 && (
          <span className="text-[10px]" style={{ color: colors.textMuted }}>
            +{tools.length - 6}
          </span>
        )}
      </span>
    </div>
  )

  if (skipMotion) return <div className="py-0.5">{inner}</div>

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12 }}
      className="py-0.5"
    >
      {inner}
    </motion.div>
  )
})

// ─── Expanded pill detail panel ───

function ExpandedPillDetail({
  tool,
  colors,
}: {
  tool: Message | undefined
  colors: ReturnType<typeof useColors>
}) {
  if (!tool) return null

  const toolName = tool.toolName || 'Tool'
  const ToolIcon = getToolIcon(toolName, tool.toolInput)
  const desc = getToolDescription(toolName, tool.toolInput)

  const showDiffViewer = (toolName === 'Edit' || toolName === 'Write') && tool.toolInput
  const hasCollapsibleContent = !showDiffViewer && tool.content.trim().length > 0

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.15 }}
      className="overflow-hidden"
      data-testid="tool-pill-detail"
    >
      <div
        className="rounded-xl p-3 mb-1.5"
        style={{
          background: colors.surfaceHover,
          border: `1px solid ${colors.toolBorder}`,
          boxShadow: colors.cardShadow,
        }}
      >
        {/* Heading: icon + tool name */}
        <div className="flex items-center gap-1.5 mb-1">
          <ToolIcon size={16} style={{ color: colors.textTertiary }} />
          <span
            className="text-[12px] font-semibold"
            style={{ color: colors.textSecondary }}
          >
            {toolName}
          </span>
        </div>
        <span
          className="text-[12px] leading-[1.4] block truncate mb-0.5"
          style={{ color: colors.textSecondary }}
        >
          <ToolDescriptionWithFilePath desc={desc} toolInput={tool.toolInput} />
        </span>
        {showDiffViewer ? (
          <ToolDetail tool={tool} />
        ) : hasCollapsibleContent ? (
          <CollapsibleToolOutput
            toolName={toolName}
            toolInput={tool.toolInput}
            content={tool.content}
            toolStatus={tool.toolStatus}
          />
        ) : (
          <ToolDetail tool={tool} />
        )}
      </div>
    </motion.div>
  )
}
