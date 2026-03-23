import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Warning, SpinnerGap } from '@phosphor-icons/react'
import { useSandboxStore } from '../stores/sandboxStore'
import { useNotificationStore } from '../stores/notificationStore'
import { useColors } from '../theme'

export function DirtyStateWarning() {
  const colors = useColors()
  const pendingDirtyWarning = useSandboxStore((s) => s.pendingDirtyWarning)
  const setPendingDirtyWarning = useSandboxStore((s) => s.setPendingDirtyWarning)
  const addToast = useNotificationStore((s) => s.addToast)
  const [stashing, setStashing] = React.useState(false)

  // Reset stashing state when warning changes
  React.useEffect(() => {
    setStashing(false)
  }, [pendingDirtyWarning])

  const handleStashAndRun = async () => {
    if (!pendingDirtyWarning || stashing) return
    setStashing(true)
    try {
      const result = await window.clui.sandboxAutoStash(
        pendingDirtyWarning.dirty.summary,
        `Auto-stash before sandbox run ${pendingDirtyWarning.runId}`,
      )
      if (result.ok) {
        addToast({ type: 'success', title: 'Changes stashed', message: result.stashRef })
      } else {
        addToast({ type: 'error', title: 'Stash failed' })
      }
    } catch {
      addToast({ type: 'error', title: 'Stash failed' })
    } finally {
      setStashing(false)
      setPendingDirtyWarning(null)
    }
  }

  const handleCancel = () => {
    setPendingDirtyWarning(null)
  }

  const dirty = pendingDirtyWarning?.dirty
  const fileCount = dirty ? dirty.untracked.length + dirty.unstaged.length : 0

  return (
    <AnimatePresence>
      {pendingDirtyWarning && (
        <motion.div
          initial={{ opacity: 0, y: -8, scaleY: 0.95 }}
          animate={{ opacity: 1, y: 0, scaleY: 1 }}
          exit={{ opacity: 0, y: -8, scaleY: 0.95 }}
          transition={{ duration: 0.2 }}
          className="mx-4 mt-2 mb-2"
        >
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: colors.containerBg,
              border: `1px solid ${colors.accentBorder}`,
            }}
          >
            {/* Header */}
            <div
              className="flex items-center gap-1.5 px-3 py-1.5"
              style={{
                background: 'rgba(217,119,87,0.08)',
                borderBottom: `1px solid ${colors.accentBorder}`,
              }}
            >
              <Warning size={12} style={{ color: colors.accent }} />
              <span className="text-[11px] font-semibold" style={{ color: colors.accent }}>
                Uncommitted Changes Detected
              </span>
            </div>

            {/* Body */}
            <div className="px-3 py-2.5">
              <p className="text-[11px] leading-[1.4] mb-2" style={{ color: colors.textSecondary }}>
                {fileCount} uncommitted file{fileCount !== 1 ? 's' : ''} found.
                {dirty && dirty.untracked.length > 0 && (
                  <span> ({dirty.untracked.length} untracked)</span>
                )}
                {dirty && dirty.unstaged.length > 0 && (
                  <span> ({dirty.unstaged.length} modified)</span>
                )}
                {' '}Stash changes before running in sandbox mode?
              </p>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleStashAndRun}
                  disabled={stashing}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  style={{
                    background: colors.accentLight,
                    color: colors.accent,
                    border: `1px solid ${colors.accentBorderMedium}`,
                  }}
                >
                  {stashing && (
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                      className="inline-flex"
                    >
                      <SpinnerGap size={12} />
                    </motion.span>
                  )}
                  {stashing ? 'Stashing...' : 'Stash & Run'}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={stashing}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: colors.surfaceSecondary,
                    color: colors.textSecondary,
                    border: `1px solid ${colors.containerBorder}`,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
