import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Folder,
  FolderOpen,
  FileText,
  CaretRight,
  CaretDown,
  SpinnerGap,
} from '@phosphor-icons/react'
import { useColors } from '../theme'
import { useSandboxStore } from '../stores/sandboxStore'
import type { FileTreeEntry } from '../../shared/sandbox-types'

interface FileTreeNodeProps {
  entry: FileTreeEntry
  cwd: string
  depth: number
}

const GIT_STATUS_COLORS: Record<string, (colors: ReturnType<typeof useColors>) => string> = {
  M: (c) => c.accent,
  A: (c) => c.statusComplete,
  D: (c) => c.statusError,
  '?': (c) => c.textTertiary,
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileTreeNode({ entry, cwd, depth }: FileTreeNodeProps) {
  const colors = useColors()
  const loadFileTree = useSandboxStore((s) => s.loadFileTree)
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FileTreeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [hovered, setHovered] = useState(false)

  const isDir = entry.type === 'directory'

  const handleClick = useCallback(async () => {
    if (isDir) {
      if (expanded) {
        setExpanded(false)
        return
      }
      setLoading(true)
      try {
        const api = window.clui as unknown as Record<string, unknown>
        if (typeof api.sandboxListFiles === 'function') {
          const listing = await (
            api.sandboxListFiles as (
              cwd: string,
              relativePath?: string,
            ) => Promise<{ entries: FileTreeEntry[]; truncated: boolean }>
          )(cwd, entry.path)
          setChildren(listing.entries)
        }
      } catch {
        setChildren([])
      } finally {
        setLoading(false)
        setExpanded(true)
      }
    } else {
      // File click: log path for now (FilePeekPanel integration later)
      console.log('[FileTreeNode] open file:', entry.path)
    }
  }, [isDir, expanded, cwd, entry.path, loadFileTree])

  const statusLetter = entry.gitStatus
  const statusColor = statusLetter
    ? GIT_STATUS_COLORS[statusLetter]?.(colors) ?? colors.textTertiary
    : null

  return (
    <div>
      <button
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          width: '100%',
          paddingLeft: depth * 16,
          paddingRight: 10,
          paddingTop: 4,
          paddingBottom: 4,
          background: hovered ? colors.surfaceHover : 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: colors.textPrimary,
          fontSize: 12,
          fontFamily: 'inherit',
          lineHeight: '20px',
        }}
        title={
          entry.size != null
            ? `${entry.path} (${formatSize(entry.size)})`
            : entry.path
        }
      >
        {/* Expand/collapse caret for directories */}
        {isDir ? (
          loading ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              style={{ display: 'flex', flexShrink: 0, width: 12, justifyContent: 'center' }}
            >
              <SpinnerGap size={10} style={{ color: colors.textTertiary }} />
            </motion.div>
          ) : expanded ? (
            <CaretDown size={10} style={{ color: colors.textTertiary, flexShrink: 0 }} />
          ) : (
            <CaretRight size={10} style={{ color: colors.textTertiary, flexShrink: 0 }} />
          )
        ) : (
          <span style={{ width: 10, flexShrink: 0 }} />
        )}

        {/* Icon */}
        {isDir ? (
          expanded ? (
            <FolderOpen size={14} style={{ color: colors.accent, flexShrink: 0 }} />
          ) : (
            <Folder size={14} style={{ color: colors.accent, flexShrink: 0 }} />
          )
        ) : (
          <FileText size={14} style={{ color: colors.textTertiary, flexShrink: 0 }} />
        )}

        {/* Name */}
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: isDir ? colors.textPrimary : colors.textSecondary,
          }}
        >
          {entry.name}
        </span>

        {/* File size on hover */}
        {hovered && entry.size != null && !isDir && (
          <span
            style={{
              fontSize: 10,
              color: colors.textTertiary,
              flexShrink: 0,
              marginRight: 4,
            }}
          >
            {formatSize(entry.size)}
          </span>
        )}

        {/* Git status badge */}
        {statusLetter && statusColor && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: statusColor,
              flexShrink: 0,
              width: 12,
              textAlign: 'center',
            }}
          >
            {statusLetter}
          </span>
        )}
      </button>

      {/* Children */}
      <AnimatePresence initial={false}>
        {expanded && children.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: 'hidden' }}
          >
            {children.map((child) => (
              <FileTreeNode
                key={child.path}
                entry={child}
                cwd={cwd}
                depth={depth + 1}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
