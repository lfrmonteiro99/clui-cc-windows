import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Copy, Check, ArrowCounterClockwise, Square, Globe, ArrowDown,
} from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { FilePath } from './FilePath'
import { isLikelyFilePath } from '../utils/file-path-detect'
import { PermissionCard } from './PermissionCard'
import { PermissionDeniedCard } from './PermissionDeniedCard'
import { RetryBanner } from './RetryBanner'
import { DirectoryPicker } from './DirectoryPicker'
import { ToolTimeline } from './ToolTimeline'
import { ShellOutput } from './ShellOutput'
import { ResumeBrief } from './ResumeBrief'
import { CodeBlock } from './CodeBlock'
import { useColors, useThemeStore } from '../theme'
import { generateResumeBrief, RESUME_INACTIVITY_MS, CATCH_ME_UP_PROMPT } from '../../shared/session-resume'
import type { ResumeBrief as ResumeBriefData } from '../../shared/session-resume'
import type { Message, ShellOutput as ShellOutputType } from '../../shared/types'

// ─── Elapsed Time Hook ───

/** Returns elapsed seconds since `active` became true, updating every 100ms. Resets on false. */
function useElapsedTime(active: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      startRef.current = null
      setElapsed(0)
      return
    }
    startRef.current = Date.now()
    setElapsed(0)
    const id = setInterval(() => {
      if (startRef.current !== null) {
        setElapsed((Date.now() - startRef.current) / 1000)
      }
    }, 100)
    return () => clearInterval(id)
  }, [active])

  return elapsed
}

// ─── Constants ───

const INITIAL_RENDER_CAP = 100
const PAGE_SIZE = 100
const REMARK_PLUGINS = [remarkGfm] // Hoisted — prevents re-parse on every render

/** Tailwind class for vertical spacing between grouped messages. Exported for testing. */
export const MESSAGE_GAP_CLASS = 'space-y-8'

// ─── Types ───

type GroupedItem =
  | { kind: 'user'; message: Message }
  | { kind: 'assistant'; message: Message }
  | { kind: 'system'; message: Message }
  | { kind: 'tool-group'; messages: Message[] }

// ─── Helpers ───

function groupMessages(messages: Message[]): GroupedItem[] {
  const result: GroupedItem[] = []
  let toolBuf: Message[] = []

  const flushTools = () => {
    if (toolBuf.length > 0) {
      result.push({ kind: 'tool-group', messages: [...toolBuf] })
      toolBuf = []
    }
  }

  for (const msg of messages) {
    if (msg.role === 'tool') {
      toolBuf.push(msg)
    } else {
      flushTools()
      if (msg.role === 'user') result.push({ kind: 'user', message: msg })
      else if (msg.role === 'assistant') result.push({ kind: 'assistant', message: msg })
      else result.push({ kind: 'system', message: msg })
    }
  }
  flushTools()
  return result
}

// ─── Main Component ───

export function ConversationView({ overrideTabId }: { overrideTabId?: string } = {}) {
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const resolvedTabId = overrideTabId || activeTabId

  // Narrow selector: only re-render when THIS tab's essential fields change
  const tab = useSessionStore(
    (s) => s.tabs.find((t) => t.id === (overrideTabId || s.activeTabId)),
    (a, b) => {
      if (a === b) return true
      if (!a || !b) return a === b
      return (
        a.id === b.id &&
        a.messages.length === b.messages.length &&
        a.status === b.status
      )
    },
  )
  const sendMessage = useSessionStore((s) => s.sendMessage)
  const staticInfo = useSessionStore((s) => s.staticInfo)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [renderOffset, setRenderOffset] = useState(0) // 0 = show from tail
  const isNearBottomRef = useRef(true)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const prevTabIdRef = useRef(resolvedTabId)
  const colors = useColors()
  const expandedUI = useThemeStore((s) => s.expandedUI)

  // ─── Elapsed time for streaming indicator ───
  const tabIsRunning = tab?.status === 'running' || tab?.status === 'connecting'
  const elapsed = useElapsedTime(tabIsRunning)

  // ─── Resume Brief state ───
  const lastViewedAtRef = useRef<Record<string, number>>({})
  const [resumeBrief, setResumeBrief] = useState<ResumeBriefData | null>(null)
  const [resumeDismissed, setResumeDismissed] = useState<Set<string>>(new Set())

  // Check for resume brief when tab becomes active
  useEffect(() => {
    if (!resolvedTabId || !tab || tab.messages.length === 0) return

    const now = Date.now()
    const lastViewed = lastViewedAtRef.current[resolvedTabId]

    if (lastViewed && (now - lastViewed) >= RESUME_INACTIVITY_MS && !resumeDismissed.has(resolvedTabId)) {
      const brief = generateResumeBrief(tab.messages, tab.status)
      setResumeBrief(brief)
    } else if (!lastViewed) {
      // First time viewing — no brief needed, just record the time
      setResumeBrief(null)
    }

    // Update last viewed timestamp
    lastViewedAtRef.current[resolvedTabId] = now
  }, [resolvedTabId]) // eslint-disable-line react-hooks/exhaustive-deps — intentionally only on tab switch

  const handleResumeDismiss = useCallback(() => {
    setResumeBrief(null)
    if (resolvedTabId) {
      setResumeDismissed((prev) => new Set(prev).add(resolvedTabId))
    }
  }, [resolvedTabId])

  const handleCatchMeUp = useCallback(() => {
    sendMessage(CATCH_ME_UP_PROMPT)
    setResumeBrief(null)
    if (resolvedTabId) {
      setResumeDismissed((prev) => new Set(prev).add(resolvedTabId))
    }
  }, [sendMessage, resolvedTabId])

  // Reset render offset and scroll state when switching tabs
  useEffect(() => {
    if (resolvedTabId !== prevTabIdRef.current) {
      prevTabIdRef.current = resolvedTabId
      setRenderOffset(0)
      isNearBottomRef.current = true
      setIsNearBottom(true)
    }
  }, [resolvedTabId])

  // Track whether user is scrolled near the bottom
  const NEAR_BOTTOM_THRESHOLD = 100
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD
    isNearBottomRef.current = nearBottom
    setIsNearBottom(nearBottom)
  }, [])

  // Auto-scroll when content changes and user is near bottom.
  // Intentionally track only message count and queue lengths — not content length —
  // so streaming chunks (which only mutate content, not count) do not trigger a scroll.
  const msgCount = tab?.messages.length ?? 0
  const lastMsgRole = tab?.messages[tab.messages.length - 1]?.role ?? ''
  const permissionQueueLen = tab?.permissionQueue?.length ?? 0
  const queuedCount = tab?.queuedPrompts?.length ?? 0
  const scrollTrigger = `${msgCount}:${lastMsgRole}:${permissionQueueLen}:${queuedCount}`

  useEffect(() => {
    if (isNearBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [scrollTrigger])

  // Group only the visible slice of messages
  const allMessages = tab?.messages ?? []
  const totalCount = allMessages.length
  const startIndex = Math.max(0, totalCount - INITIAL_RENDER_CAP - renderOffset * PAGE_SIZE)
  const visibleMessages = startIndex > 0 ? allMessages.slice(startIndex) : allMessages
  const hasOlder = startIndex > 0

  const grouped = useMemo(
    () => groupMessages(visibleMessages),
    [visibleMessages],
  )

  const hiddenCount = totalCount - visibleMessages.length

  const handleLoadOlder = useCallback(() => {
    setRenderOffset((o) => o + 1)
  }, [])

  const handleJumpToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    isNearBottomRef.current = true
    setIsNearBottom(true)
  }, [])

  if (!tab) return null

  const isRunning = tab.status === 'running' || tab.status === 'connecting'
  // Show jump button when user scrolled away from bottom AND content is actively streaming
  const showJumpButton = !isNearBottom && isRunning
  const isDead = tab.status === 'dead'
  const isFailed = tab.status === 'failed'
  const showInterrupt = isRunning && tab.messages.some((m) => m.role === 'user')

  if (tab.messages.length === 0) {
    return <EmptyState />
  }

  // Messages from before initial render cap are "historical" — no motion
  const historicalThreshold = Math.max(0, totalCount - 20)

  // Find the last assistant message index in grouped items for streaming cursor
  const lastAssistantGroupIdx = isRunning
    ? grouped.reduceRight<number>((found, item, idx) => found >= 0 ? found : (item.kind === 'assistant' ? idx : -1), -1)
    : -1

  const handleRetry = () => {
    const lastUserMsg = [...tab.messages].reverse().find((m) => m.role === 'user')
    if (lastUserMsg) {
      sendMessage(lastUserMsg.content)
    }
  }

  return (
    <div
      data-clui-ui
      data-testid="conversation-view"
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <AnimatePresence>
        {tab.retryState && <RetryBanner tabId={tab.id} />}
      </AnimatePresence>

      {/* Scrollable messages area */}
      <div
        ref={scrollRef}
        className="overflow-y-auto overflow-x-hidden px-4 pt-2 conversation-selectable conversation-scroll"
        style={{
          maxHeight: expandedUI ? 460 : 336,
          paddingBottom: 28,
          background: `linear-gradient(to bottom, ${colors.containerBg}, ${colors.accentGhost})`,
        }}
        onScroll={handleScroll}
      >
        {/* Load older button */}
        {hasOlder && (
          <div className="flex justify-center py-2">
            <button
              onClick={handleLoadOlder}
              className="text-[11px] px-3 py-1 rounded-full transition-colors"
              style={{ color: colors.textTertiary, border: `1px solid ${colors.toolBorder}` }}
            >
              Load {Math.min(PAGE_SIZE, hiddenCount)} older messages ({hiddenCount} hidden)
            </button>
          </div>
        )}

        {/* Resume brief card */}
        <AnimatePresence>
          {resumeBrief && (
            <ResumeBrief
              brief={resumeBrief}
              onCatchMeUp={handleCatchMeUp}
              onDismiss={handleResumeDismiss}
            />
          )}
        </AnimatePresence>

        <div className={`${MESSAGE_GAP_CLASS} relative`}>
          {grouped.map((item, idx) => {
            const msgIndex = startIndex + idx
            const isHistorical = msgIndex < historicalThreshold

            switch (item.kind) {
              case 'user':
                return <UserMessage key={item.message.id} message={item.message} skipMotion={isHistorical} />
              case 'assistant':
                return <AssistantMessage key={item.message.id} message={item.message} skipMotion={isHistorical} isStreaming={idx === lastAssistantGroupIdx} />
              case 'tool-group':
                return <ToolTimeline key={`tg-${item.messages[0].id}`} tools={item.messages} skipMotion={isHistorical} />
              case 'system':
                return <SystemMessage key={item.message.id} message={item.message} skipMotion={isHistorical} />
              default:
                return null
            }
          })}
        </div>

        {/* Permission card (shows first item from queue) */}
        <AnimatePresence>
          {tab.permissionQueue.length > 0 && (
            <PermissionCard
              tabId={tab.id}
              permission={tab.permissionQueue[0]}
              queueLength={tab.permissionQueue.length}
            />
          )}
        </AnimatePresence>

        {/* Permission denied fallback card */}
        <AnimatePresence>
          {tab.permissionDenied && (
            <PermissionDeniedCard
              tools={tab.permissionDenied.tools}
              sessionId={tab.claudeSessionId}
              projectPath={staticInfo?.projectPath || process.cwd()}
              onDismiss={() => {
                useSessionStore.setState((s) => ({
                  tabs: s.tabs.map((t) =>
                    t.id === tab.id ? { ...t, permissionDenied: null } : t
                  ),
                }))
              }}
            />
          )}
        </AnimatePresence>

        {/* Queued prompts */}
        <AnimatePresence>
          {tab.queuedPrompts.map((prompt, i) => (
            <QueuedMessage key={`queued-${i}`} content={prompt} />
          ))}
        </AnimatePresence>

        <div ref={bottomRef} />
      </div>

      {/* Jump to bottom button — shown when scrolled up during streaming */}
      <AnimatePresence>
        {showJumpButton && (
          <motion.button
            data-testid="jump-to-bottom"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            onClick={handleJumpToBottom}
            className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] cursor-pointer z-10"
            style={{
              bottom: 36,
              background: colors.surfacePrimary,
              color: colors.textSecondary,
              border: `1px solid ${colors.containerBorder}`,
              boxShadow: colors.cardShadow,
            }}
            title="Jump to bottom"
          >
            <ArrowDown size={12} weight="bold" />
            <span>New messages</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Visual separator between conversation and input */}
      <div className="conversation-separator" />

      {/* Activity row — overlaps bottom of scroll area as a fade strip */}
      <div
        className="flex items-center justify-between px-4 relative"
        style={{
          height: 28,
          minHeight: 28,
          marginTop: -28,
          background: `linear-gradient(to bottom, transparent, ${colors.containerBg} 70%)`,
          zIndex: 2,
        }}
      >
        {/* Left: status indicator */}
        <div className="flex items-center gap-1.5 text-[11px] min-w-0">
          {isRunning && (
            <span className="flex items-center gap-1.5">
              <span className="flex gap-[3px]">
                <span className="w-[4px] h-[4px] rounded-full animate-bounce-dot" style={{ background: colors.statusRunning, animationDelay: '0ms' }} />
                <span className="w-[4px] h-[4px] rounded-full animate-bounce-dot" style={{ background: colors.statusRunning, animationDelay: '150ms' }} />
                <span className="w-[4px] h-[4px] rounded-full animate-bounce-dot" style={{ background: colors.statusRunning, animationDelay: '300ms' }} />
              </span>
              <span style={{ color: colors.textSecondary }}>
                {tab.currentActivity || 'Working...'}
                {elapsed > 0 && <span data-testid="elapsed-time" style={{ color: colors.textTertiary, marginLeft: 6 }}>{elapsed.toFixed(1)}s</span>}
              </span>
            </span>
          )}

          {isDead && (
            <span style={{ color: colors.statusError, fontSize: 11 }}>Session ended unexpectedly</span>
          )}

          {isFailed && (
            <span className="flex items-center gap-1.5">
              <span style={{ color: colors.statusError, fontSize: 11 }}>Failed</span>
              <button
                onClick={handleRetry}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors"
                style={{ color: colors.accent, fontSize: 11 }}
              >
                <ArrowCounterClockwise size={10} />
                Retry
              </button>
            </span>
          )}
        </div>

        {/* Right: interrupt button when running */}
        <div className="flex items-center flex-shrink-0">
          <AnimatePresence>
            {showInterrupt && (
              <InterruptButton tabId={tab.id} />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

// ─── Empty State (directory picker before first message) ───

function EmptyState() {
  const setBaseDirectory = useSessionStore((s) => s.setBaseDirectory)

  const handleDirectorySelect = useCallback(
    (dir: string, runtime: import('./DirectoryPicker').RuntimeType, distro: string | null) => {
      setBaseDirectory(dir)
      // Update tab runtime/distro via direct store mutation (setBaseDirectory only sets directory)
      const { activeTabId } = useSessionStore.getState()
      useSessionStore.setState((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === activeTabId ? { ...t, runtime, wslDistro: distro } : t,
        ),
      }))
    },
    [setBaseDirectory],
  )

  return (
    <div
      className="flex flex-col items-center justify-center py-4"
      style={{ minHeight: 80 }}
    >
      <DirectoryPicker onSelect={handleDirectorySelect} />
    </div>
  )
}

// ─── Copy Button ───

const CopyButton = React.memo(function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const colors = useColors()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
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
      title="Copy response"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </motion.button>
  )
})

// ─── Interrupt Button ───

const InterruptButton = React.memo(function InterruptButton({ tabId }: { tabId: string }) {
  const colors = useColors()

  const handleStop = () => {
    window.clui.stopTab(tabId)
  }

  return (
    <motion.button
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onClick={handleStop}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] cursor-pointer flex-shrink-0 transition-colors"
      style={{
        background: 'transparent',
        color: colors.statusError,
        border: 'none',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = colors.statusErrorBg }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      title="Stop current task"
    >
      <Square size={9} weight="fill" />
      <span>Interrupt</span>
    </motion.button>
  )
})

// ─── User Message (memoized — only re-renders when message reference changes) ───

export const UserMessage = React.memo(function UserMessage({ message, skipMotion }: { message: Message; skipMotion?: boolean }) {
  const colors = useColors()
  const content = (
    <div
      data-testid="message-user"
      className="text-[13px] leading-[1.6] max-w-[85%]"
      style={{
        background: colors.messageBgUser,
        color: colors.userBubbleText,
        border: `1px solid ${colors.userBubbleBorder}`,
        borderRadius: '12px',
        padding: '12px 16px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}
    >
      {message.content}
    </div>
  )

  if (skipMotion) {
    return <div className="flex justify-end py-1.5">{content}</div>
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex justify-end py-1.5"
    >
      {content}
    </motion.div>
  )
})

// ─── Queued Message (waiting at bottom until processed) ───

const QueuedMessage = React.memo(function QueuedMessage({ content }: { content: string }) {
  const colors = useColors()

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className="flex justify-end py-1.5"
    >
      <div
        className="text-[13px] leading-[1.6] px-3 py-1.5 max-w-[85%]"
        style={{
          background: colors.userBubble,
          color: colors.userBubbleText,
          border: `1px dashed ${colors.userBubbleBorder}`,
          borderRadius: '14px 14px 4px 14px',
          opacity: 0.6,
        }}
      >
        {content}
      </div>
    </motion.div>
  )
})

// ─── Table scroll wrapper — fade edges when horizontally scrollable ───

function TableScrollWrapper({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState<string | undefined>(undefined)
  const prevFade = useRef<string | undefined>(undefined)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    let next: string | undefined
    if (scrollWidth <= clientWidth + 1) {
      next = undefined
    } else {
      const l = scrollLeft > 1
      const r = scrollLeft + clientWidth < scrollWidth - 1
      next = l && r
        ? 'linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)'
        : l
          ? 'linear-gradient(to right, transparent, black 24px)'
          : r
            ? 'linear-gradient(to right, black calc(100% - 24px), transparent)'
            : undefined
    }
    if (next !== prevFade.current) {
      prevFade.current = next
      setFade(next)
    }
  }, [])

  useEffect(() => {
    update()
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    const table = el.querySelector('table')
    if (table) ro.observe(table)
    return () => ro.disconnect()
  }, [update])

  return (
    <div
      ref={ref}
      onScroll={update}
      style={{
        overflowX: 'auto',
        scrollbarWidth: 'thin',
        maskImage: fade,
        WebkitMaskImage: fade,
      }}
    >
      <table>{children}</table>
    </div>
  )
}

// ─── Image card — graceful fallback when src returns 404 ───

function ImageCard({ src, alt, colors }: { src?: string; alt?: string; colors: ReturnType<typeof useColors> }) {
  const [failed, setFailed] = useState(false)
  // Reset failed state when src changes (e.g. during streaming)
  useEffect(() => { setFailed(false) }, [src])
  const label = alt || 'Image'
  const open = () => { if (src) window.clui.openExternal(String(src)) }

  if (failed || !src) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1.5 my-1 px-2.5 py-1.5 rounded-md text-[12px] cursor-pointer"
        style={{ background: colors.surfacePrimary, color: colors.accent, border: `1px solid ${colors.toolBorder}` }}
        onClick={open}
        title={src}
      >
        <Globe size={12} />
        Image unavailable{alt ? ` — ${alt}` : ''}
      </button>
    )
  }

  return (
    <button
      type="button"
      className="block my-2 rounded-lg overflow-hidden border text-left cursor-pointer"
      style={{ borderColor: colors.toolBorder, background: colors.surfacePrimary }}
      onClick={open}
      title={src}
    >
      <img
        src={src}
        alt={label}
        className="block w-full max-h-[260px] object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
      {alt && (
        <div className="px-2 py-1 text-[11px]" style={{ color: colors.textTertiary }}>
          {alt}
        </div>
      )}
    </button>
  )
}

// ─── Assistant Message (memoized — only re-renders when content changes) ───

export const AssistantMessage = React.memo(function AssistantMessage({
  message,
  skipMotion,
  isStreaming,
}: {
  message: Message
  skipMotion?: boolean
  isStreaming?: boolean
}) {
  const colors = useColors()

  const markdownComponents = useMemo(() => ({
    table: ({ children }: any) => <TableScrollWrapper>{children}</TableScrollWrapper>,
    // Strip default <pre> styling when CodeBlock handles its own wrapper
    pre: ({ children }: any) => <>{children}</>,
    code: ({ children, className, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '')
      const isBlock = match || props.node?.position?.start?.line !== props.node?.position?.end?.line

      if (match || isBlock) {
        const language = match ? match[1] : ''
        const code = String(children).replace(/\n$/, '')
        return <CodeBlock code={code} language={language} />
      }

      // Inline code — detect file paths
      const text = typeof children === 'string' ? children : String(children ?? '')
      if (isLikelyFilePath(text)) return <FilePath path={text} displayName={text} />
      return <code className={className}>{children}</code>
    },
    a: ({ href, children }: any) => (
      <button
        type="button"
        className="underline decoration-dotted underline-offset-2 cursor-pointer"
        style={{ color: colors.accent }}
        onClick={() => {
          if (href) window.clui.openExternal(String(href))
        }}
      >
        {children}
      </button>
    ),
    img: ({ src, alt }: any) => <ImageCard src={src} alt={alt} colors={colors} />,
  }), [colors])

  const inner = (
    <div
      data-testid="message-assistant"
      className="group/msg relative px-4 py-3 transition-shadow duration-150"
      style={{
        background: colors.messageBgAssistant,
        borderLeft: `4px solid ${colors.messageAccentBorder}`,
        borderRadius: '12px',
        boxShadow: colors.cardShadowMd,
      }}
    >
      <div className={`text-[13px] leading-[1.6] prose-cloud min-w-0 max-w-[92%]${isStreaming ? ' streaming-cursor' : ''}`}>
        <Markdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
          {message.content}
        </Markdown>
      </div>
      {/* Copy button — always in DOM, shown via CSS :hover (no React state needed).
          Absolute positioning so it never shifts the text layout. */}
      {message.content.trim() && (
        <div className="absolute bottom-0 right-0 opacity-40 group-hover/msg:opacity-100 transition-opacity duration-100">
          <CopyButton text={message.content} />
        </div>
      )}
    </div>
  )

  if (skipMotion) {
    return <div className="py-1">{inner}</div>
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="py-1"
    >
      {inner}
    </motion.div>
  )
}, (prev, next) => prev.message.content === next.message.content && prev.skipMotion === next.skipMotion && prev.isStreaming === next.isStreaming)

// ─── System Message (memoized) ───

const SHELL_PREFIX = '{"__shell__":true,'

function tryParseShellOutput(content: string): ShellOutputType | null {
  if (!content.startsWith(SHELL_PREFIX)) return null
  try {
    const parsed = JSON.parse(content)
    if (parsed.__shell__ && typeof parsed.command === 'string') {
      return parsed as ShellOutputType
    }
  } catch (err) {
    console.warn('[ConversationView] Failed to parse shell output:', err)
  }
  return null
}

export const SystemMessage = React.memo(function SystemMessage({ message, skipMotion }: { message: Message; skipMotion?: boolean }) {
  const isError = message.content.startsWith('Error:') || message.content.includes('unexpectedly')
  const colors = useColors()

  // Check if this is a shell output message
  const shellOutput = tryParseShellOutput(message.content)
  if (shellOutput) {
    const shellInner = <ShellOutput output={shellOutput} />
    if (skipMotion) return <div className="py-1">{shellInner}</div>
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="py-1"
      >
        {shellInner}
      </motion.div>
    )
  }

  const inner = (
    <div
      data-testid={isError ? 'message-system-error' : 'message-system'}
      className="text-xs leading-[1.5] px-2.5 py-1 rounded-lg inline-block whitespace-pre-wrap"
      style={{
        background: isError ? colors.statusErrorBg : colors.surfaceHover,
        color: isError ? colors.statusError : colors.textTertiary,
        fontStyle: 'italic',
      }}
    >
      {message.content}
    </div>
  )

  if (skipMotion) return <div className="py-0.5 text-center">{inner}</div>

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="py-0.5 text-center"
    >
      {inner}
    </motion.div>
  )
})

