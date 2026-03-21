import React, { useEffect, useMemo, useCallback, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain,
  ClockCounterClockwise,
  Files,
  Code,
  PushPin,
  Trash,
  MagnifyingGlass,
  X,
  SpinnerGap,
  PushPinSlash,
} from '@phosphor-icons/react'
import { useContextStore, type ContextState } from '../stores/contextStore'
import { useSessionStore } from '../stores/sessionStore'
import { useNotificationStore } from '../stores/notificationStore'
import { useColors } from '../theme'
import type {
  ContextSessionSummary,
  ContextFileTouched,
  MemorySearchResult,
  ContextProjectStats,
} from '../../shared/context-types'

type Section = ContextState['activeSection']

const SECTIONS: Array<{ id: Section; label: string; icon: React.ReactNode }> = [
  { id: 'memories', label: 'Memories', icon: <Brain size={14} /> },
  { id: 'sessions', label: 'Sessions', icon: <ClockCounterClockwise size={14} /> },
  { id: 'files', label: 'Files', icon: <Files size={14} /> },
  { id: 'preview', label: 'Preview', icon: <Code size={14} /> },
]

export function ContextPanel() {
  const colors = useColors()
  const panelOpen = useContextStore((s) => s.panelOpen)
  const closePanel = useContextStore((s) => s.closePanel)
  const activeSection = useContextStore((s) => s.activeSection)
  const setActiveSection = useContextStore((s) => s.setActiveSection)
  const isLoading = useContextStore((s) => s.isLoading)

  const activeTabId = useSessionStore((s) => s.activeTabId)
  const tabs = useSessionStore((s) => s.tabs)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const projectPath = activeTab?.workingDirectory || ''

  // Load data when panel opens
  useEffect(() => {
    if (!panelOpen || !projectPath) return

    const store = useContextStore.getState()
    store.loadProjectStats(projectPath)
    store.loadMemories(projectPath)
    store.loadSessionHistory(projectPath)
    store.loadFilesTouched(projectPath)
  }, [panelOpen, projectPath])

  // Listen for broadcast events
  useEffect(() => {
    if (!window.clui?.onContextMemoryCreated) return

    const unsubMemory = window.clui.onContextMemoryCreated((memory) => {
      useContextStore.getState().handleMemoryCreated(memory)
      useNotificationStore.getState().addToast({
        type: 'info',
        title: 'Memory created',
        message: memory.title,
        duration: 3000,
      })
    })

    const unsubSession = window.clui.onContextSessionRecorded((session) => {
      useContextStore.getState().handleSessionRecorded(session)
    })

    return () => {
      unsubMemory()
      unsubSession()
    }
  }, [])

  if (!panelOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        data-clui-ui
        data-testid="context-panel"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ duration: 0.15 }}
        style={{
          height: 470,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 18px 10px',
            borderBottom: `1px solid ${colors.containerBorder}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Brain size={20} weight="regular" style={{ color: colors.accent }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: colors.textPrimary }}>
                Context Database
              </div>
              <ProjectStatsLine />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isLoading && (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                style={{ display: 'flex' }}
              >
                <SpinnerGap size={14} style={{ color: colors.accent }} />
              </motion.div>
            )}
            <button
              onClick={closePanel}
              aria-label="Close context panel"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: colors.textTertiary,
                padding: 2,
                display: 'flex',
                borderRadius: 4,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = colors.textPrimary)}
              onMouseLeave={(e) => (e.currentTarget.style.color = colors.textTertiary)}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Section tabs */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: '10px 18px',
            borderBottom: `1px solid ${colors.containerBorder}`,
          }}
        >
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
                padding: '6px 10px',
                borderRadius: 8,
                border: `1px solid ${activeSection === section.id ? colors.accent : colors.containerBorder}`,
                background: activeSection === section.id ? colors.accentLight : 'transparent',
                color: activeSection === section.id ? colors.accent : colors.textSecondary,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
            >
              {section.icon}
              {section.label}
            </button>
          ))}
        </div>

        {/* Section content */}
        <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin' }}>
          {activeSection === 'memories' && <MemoriesSection projectPath={projectPath} />}
          {activeSection === 'sessions' && <SessionsSection />}
          {activeSection === 'files' && <FilesSection />}
          {activeSection === 'preview' && <PreviewSection projectPath={projectPath} />}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

// ─── Project stats line ───

function ProjectStatsLine() {
  const colors = useColors()
  const stats = useContextStore((s) => s.projectStats)

  if (!stats) {
    return (
      <div style={{ fontSize: 11, color: colors.textTertiary, marginTop: 2 }}>
        No context data yet
      </div>
    )
  }

  return (
    <div style={{ fontSize: 11, color: colors.textTertiary, marginTop: 2 }}>
      {stats.sessionCount} sessions, {stats.memoryCount} memories, {stats.uniqueFilesTouched} files
    </div>
  )
}

// ─── Memories section ───

function MemoriesSection({ projectPath }: { projectPath: string }) {
  const colors = useColors()
  const memories = useContextStore((s) => s.memories)
  const searchQuery = useContextStore((s) => s.searchQuery)
  const setSearchQuery = useContextStore((s) => s.setSearchQuery)
  const loadMemories = useContextStore((s) => s.loadMemories)
  const pinMemory = useContextStore((s) => s.pinMemory)
  const unpinMemory = useContextStore((s) => s.unpinMemory)
  const deleteMemory = useContextStore((s) => s.deleteMemory)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value
      setSearchQuery(query)
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        loadMemories(projectPath, query)
      }, 300)
    },
    [projectPath, setSearchQuery, loadMemories],
  )

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  return (
    <div style={{ padding: '12px 18px' }}>
      {/* Search */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: colors.inputPillBg,
          borderRadius: 10,
          padding: '8px 10px',
          border: `1px solid ${colors.containerBorder}`,
          marginBottom: 12,
        }}
      >
        <MagnifyingGlass size={13} style={{ color: colors.textTertiary, flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Search memories..."
          value={searchQuery}
          onChange={handleSearchChange}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            color: colors.textPrimary,
            fontSize: 12,
            fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Memory list */}
      {memories.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, color: colors.textTertiary }}>
          No memories found
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {memories.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              colors={colors}
              onPin={() => pinMemory(memory.id)}
              onUnpin={() => unpinMemory(memory.id)}
              onDelete={() => deleteMemory(memory.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Memory card ───

function MemoryCard({
  memory,
  colors,
  onPin,
  onUnpin,
  onDelete,
}: {
  memory: MemorySearchResult
  colors: ReturnType<typeof useColors>
  onPin: () => void
  onUnpin: () => void
  onDelete: () => void
}) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${memory.isPinned ? colors.accentBorder : colors.containerBorder}`,
        background: memory.isPinned ? colors.accentLight : colors.surfaceHover,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <ImportanceBadge score={memory.importanceScore} colors={colors} />
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: 999,
                background: colors.surfacePrimary,
                color: colors.textTertiary,
              }}
            >
              {memory.memoryType}
            </span>
            {memory.isPinned && (
              <PushPin size={10} weight="fill" style={{ color: colors.accent }} />
            )}
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.textPrimary,
              marginBottom: 2,
            }}
          >
            {memory.title}
          </div>
          {memory.body && (
            <div
              style={{
                fontSize: 11,
                color: colors.textSecondary,
                lineHeight: 1.4,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {memory.body}
            </div>
          )}
          <div style={{ fontSize: 10, color: colors.textTertiary, marginTop: 4 }}>
            {new Date(memory.createdAt).toLocaleDateString()} · accessed {memory.accessCount}x
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button
            onClick={memory.isPinned ? onUnpin : onPin}
            title={memory.isPinned ? 'Unpin memory' : 'Pin memory'}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: memory.isPinned ? colors.accent : colors.textTertiary,
              padding: 4,
              display: 'flex',
              borderRadius: 4,
            }}
          >
            {memory.isPinned ? <PushPinSlash size={14} /> : <PushPin size={14} />}
          </button>
          <button
            onClick={onDelete}
            title="Delete memory"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: colors.textTertiary,
              padding: 4,
              display: 'flex',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = colors.statusError)}
            onMouseLeave={(e) => (e.currentTarget.style.color = colors.textTertiary)}
          >
            <Trash size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Importance badge ───

function ImportanceBadge({ score, colors }: { score: number; colors: ReturnType<typeof useColors> }) {
  let label: string
  let bg: string
  let color: string

  if (score >= 0.7) {
    label = 'High'
    bg = colors.accentLight
    color = colors.accent
  } else if (score >= 0.4) {
    label = 'Medium'
    bg = colors.statusCompleteBg
    color = colors.statusComplete
  } else {
    label = 'Low'
    bg = colors.surfacePrimary
    color = colors.textTertiary
  }

  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: 999,
        background: bg,
        color,
      }}
    >
      {label}
    </span>
  )
}

// ─── Sessions section ───

function SessionsSection() {
  const colors = useColors()
  const sessions = useContextStore((s) => s.sessionHistory)

  if (sessions.length === 0) {
    return (
      <div style={{ padding: '32px 18px', textAlign: 'center', fontSize: 11, color: colors.textTertiary }}>
        No session history yet
      </div>
    )
  }

  return (
    <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sessions.map((session) => (
        <SessionCard key={session.id} session={session} colors={colors} />
      ))}
    </div>
  )
}

function SessionCard({ session, colors }: { session: ContextSessionSummary; colors: ReturnType<typeof useColors> }) {
  const statusColor = session.status === 'completed' ? colors.statusComplete
    : session.status === 'dead' ? colors.statusDead
    : colors.statusIdle

  const statusBg = session.status === 'completed' ? colors.statusCompleteBg
    : session.status === 'dead' ? colors.statusErrorBg
    : colors.surfacePrimary

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${colors.containerBorder}`,
        background: colors.surfaceHover,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 999,
            background: statusBg,
            color: statusColor,
          }}
        >
          {session.status}
        </span>
        <span style={{ fontSize: 10, color: colors.textTertiary }}>
          {new Date(session.startedAt).toLocaleDateString()}
        </span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: colors.textPrimary, marginBottom: 2 }}>
        {session.title || session.goal || 'Untitled session'}
      </div>
      {session.summary && (
        <div
          style={{
            fontSize: 11,
            color: colors.textSecondary,
            lineHeight: 1.4,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            marginBottom: 4,
          }}
        >
          {session.summary}
        </div>
      )}
      <div style={{ fontSize: 10, color: colors.textTertiary, display: 'flex', gap: 8 }}>
        <span>{session.filesTouchedCount} files</span>
        {session.durationMs != null && (
          <span>{formatDuration(session.durationMs)}</span>
        )}
        {session.toolsUsed.length > 0 && (
          <span>{session.toolsUsed.length} tools</span>
        )}
      </div>
    </div>
  )
}

// ─── Files section ───

function FilesSection() {
  const colors = useColors()
  const filesTouched = useContextStore((s) => s.filesTouched)

  if (filesTouched.length === 0) {
    return (
      <div style={{ padding: '32px 18px', textAlign: 'center', fontSize: 11, color: colors.textTertiary }}>
        No file activity recorded
      </div>
    )
  }

  return (
    <div style={{ padding: '12px 18px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${colors.containerBorder}` }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: colors.textTertiary, fontWeight: 600 }}>Path</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: colors.textTertiary, fontWeight: 600 }}>Touches</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: colors.textTertiary, fontWeight: 600 }}>Actions</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: colors.textTertiary, fontWeight: 600 }}>Last</th>
          </tr>
        </thead>
        <tbody>
          {filesTouched.map((file) => (
            <FileRow key={file.path} file={file} colors={colors} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FileRow({ file, colors }: { file: ContextFileTouched; colors: ReturnType<typeof useColors> }) {
  return (
    <tr style={{ borderBottom: `1px solid ${colors.containerBorder}` }}>
      <td
        style={{
          padding: '6px 8px',
          color: colors.textPrimary,
          fontFamily: 'monospace',
          fontSize: 10,
          maxWidth: 200,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={file.path}
      >
        {file.path}
      </td>
      <td style={{ padding: '6px 8px', color: colors.textSecondary, textAlign: 'right' }}>
        {file.totalTouches}
      </td>
      <td style={{ padding: '6px 8px' }}>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {file.actions.map((action) => (
            <span
              key={action}
              style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 999,
                background: colors.surfacePrimary,
                color: colors.textTertiary,
              }}
            >
              {action}
            </span>
          ))}
        </div>
      </td>
      <td style={{ padding: '6px 8px', color: colors.textTertiary, fontSize: 10 }}>
        {new Date(file.lastTouched).toLocaleDateString()}
      </td>
    </tr>
  )
}

// ─── Preview section ───

function PreviewSection({ projectPath }: { projectPath: string }) {
  const colors = useColors()
  const preview = useContextStore((s) => s.memoryPacketPreview)
  const loadPreview = useContextStore((s) => s.loadPacketPreview)
  const isLoading = useContextStore((s) => s.isLoading)
  const activeTabId = useSessionStore((s) => s.activeTabId)

  useEffect(() => {
    if (projectPath && activeTabId) {
      loadPreview(projectPath, activeTabId, '')
    }
  }, [projectPath, activeTabId, loadPreview])

  return (
    <div style={{ padding: '12px 18px' }}>
      <div style={{ fontSize: 11, color: colors.textTertiary, marginBottom: 8 }}>
        XML context block that would be injected into the next prompt:
      </div>
      {isLoading ? (
        <div style={{ padding: '20px 0', textAlign: 'center' }}>
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            style={{ display: 'inline-flex' }}
          >
            <SpinnerGap size={16} style={{ color: colors.accent }} />
          </motion.div>
        </div>
      ) : preview ? (
        <pre
          style={{
            fontSize: 10,
            fontFamily: 'monospace',
            lineHeight: 1.5,
            color: colors.textSecondary,
            background: colors.codeBg,
            padding: '10px 12px',
            borderRadius: 8,
            border: `1px solid ${colors.containerBorder}`,
            overflow: 'auto',
            maxHeight: 320,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {preview}
        </pre>
      ) : (
        <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, color: colors.textTertiary }}>
          No context data available for this project
        </div>
      )}
    </div>
  )
}

// ─── Helpers ───

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const remainder = s % 60
  return remainder > 0 ? `${m}m${remainder}s` : `${m}m`
}
