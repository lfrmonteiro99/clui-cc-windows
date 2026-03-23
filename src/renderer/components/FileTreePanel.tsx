import React, { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TreeStructure,
  X,
  SpinnerGap,
  FolderDashed,
  Warning,
} from '@phosphor-icons/react'
import { useColors } from '../theme'
import { useSessionStore } from '../stores/sessionStore'
import { useSandboxStore } from '../stores/sandboxStore'
import { FileTreeNode } from './FileTreeNode'

const PANEL_WIDTH = 280
const TRANSITION = { duration: 0.2, ease: [0.4, 0, 0.1, 1] as const }

export function FileTreePanel() {
  const colors = useColors()

  const fileTreeOpen = useSandboxStore((s) => s.fileTreeOpen)
  const setFileTreeOpen = useSandboxStore((s) => s.setFileTreeOpen)
  const fileTreeEntries = useSandboxStore((s) => s.fileTreeEntries)
  const fileTreeLoading = useSandboxStore((s) => s.fileTreeLoading)
  const loadFileTree = useSandboxStore((s) => s.loadFileTree)

  const workingDirectory = useSessionStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.workingDirectory ?? '',
  )

  // Load root entries on mount / when cwd changes
  useEffect(() => {
    if (fileTreeOpen && workingDirectory) {
      void loadFileTree(workingDirectory)
    }
  }, [fileTreeOpen, workingDirectory, loadFileTree])

  const entries = fileTreeEntries?.entries ?? []
  const truncated = fileTreeEntries?.truncated ?? false

  return (
    <AnimatePresence>
      {fileTreeOpen && (
        <motion.div
          data-clui-ui
          initial={{ x: PANEL_WIDTH, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: PANEL_WIDTH, opacity: 0 }}
          transition={TRANSITION}
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: PANEL_WIDTH,
            display: 'flex',
            flexDirection: 'column',
            background: colors.containerBg,
            borderLeft: `1px solid ${colors.containerBorder}`,
            boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
            zIndex: 40,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 14px',
              borderBottom: `1px solid ${colors.containerBorder}`,
              flexShrink: 0,
            }}
          >
            <TreeStructure size={16} style={{ color: colors.accent, flexShrink: 0 }} />
            <span
              style={{
                color: colors.textPrimary,
                fontSize: 13,
                fontWeight: 600,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              File Tree
            </span>

            <button
              onClick={() => setFileTreeOpen(false)}
              title="Close"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 26,
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                color: colors.textTertiary,
                cursor: 'pointer',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = colors.surfaceHover
                e.currentTarget.style.color = colors.textSecondary
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = colors.textTertiary
              }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '4px 0',
            }}
          >
            {fileTreeLoading && entries.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 40,
                }}
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <SpinnerGap size={24} style={{ color: colors.textTertiary }} />
                </motion.div>
              </div>
            ) : !workingDirectory ? (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <Warning size={28} style={{ color: colors.textTertiary, marginBottom: 8 }} />
                <div style={{ color: colors.textTertiary, fontSize: 12 }}>
                  No working directory
                </div>
                <div style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
                  Select a tab with an active session
                </div>
              </div>
            ) : entries.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <FolderDashed size={28} style={{ color: colors.textTertiary, marginBottom: 8 }} />
                <div style={{ color: colors.textTertiary, fontSize: 12 }}>
                  No files found
                </div>
              </div>
            ) : (
              entries.map((entry) => (
                <FileTreeNode
                  key={entry.path}
                  entry={entry}
                  cwd={workingDirectory}
                  depth={1}
                />
              ))
            )}
          </div>

          {/* Footer */}
          {entries.length > 0 && (
            <div
              style={{
                padding: '8px 14px',
                borderTop: `1px solid ${colors.containerBorder}`,
                fontSize: 10,
                color: colors.textTertiary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}
            >
              <span>
                {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
              </span>
              {truncated && (
                <span
                  style={{
                    color: colors.statusError,
                    fontWeight: 500,
                  }}
                >
                  Truncated
                </span>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
