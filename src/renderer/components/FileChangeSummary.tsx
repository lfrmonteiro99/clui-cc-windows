/**
 * FileChangeSummary — compact pill showing "X files changed" after a run completes.
 * Click to expand and see the list of modified files.
 */

import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, CaretDown, CaretRight } from '@phosphor-icons/react'
import { useColors } from '../theme'
import type { FileChange } from '../stores/fileChangeStore'

interface Props {
  changes: FileChange[]
  skipMotion?: boolean
}

export const FileChangeSummary = React.memo(function FileChangeSummary({ changes, skipMotion }: Props) {
  const [expanded, setExpanded] = useState(false)
  const colors = useColors()

  const uniqueFiles = useMemo(() => {
    const seen = new Map<string, FileChange>()
    for (const change of changes) {
      // Keep latest change per file
      seen.set(change.filePath, change)
    }
    return [...seen.values()]
  }, [changes])

  if (uniqueFiles.length === 0) return null

  const inner = (
    <div
      className="flex flex-col gap-1 py-1"
      style={{ color: colors.textTertiary }}
    >
      <div
        className="flex items-center gap-1.5 cursor-pointer text-[11px]"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
        <FileText size={12} />
        <span>
          {uniqueFiles.length} file{uniqueFiles.length !== 1 ? 's' : ''} changed
        </span>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="pl-5 space-y-0.5">
              {uniqueFiles.map((change) => (
                <div
                  key={change.filePath}
                  className="flex items-center gap-1.5 text-[11px]"
                >
                  <span style={{ color: colors.textMuted }}>
                    {change.toolName}
                  </span>
                  <span
                    className="truncate"
                    style={{ color: colors.textSecondary }}
                    title={change.filePath}
                  >
                    {change.filePath}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  if (skipMotion) return inner

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12 }}
    >
      {inner}
    </motion.div>
  )
})
