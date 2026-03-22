import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { ClockCounterClockwise, FileText, Check, X, CaretDown, CaretRight } from '@phosphor-icons/react'
import { useColors } from '../theme'
import type { ResumeBrief as ResumeBriefData } from '../../shared/session-resume'

interface ResumeBriefProps {
  brief: ResumeBriefData
  onCatchMeUp: () => void
  onDismiss: () => void
}

const STATUS_LABELS: Record<ResumeBriefData['status'], string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  interrupted: 'Interrupted',
}

export function ResumeBrief({ brief, onCatchMeUp, onDismiss }: ResumeBriefProps) {
  const colors = useColors()
  const [filesExpanded, setFilesExpanded] = useState(false)

  const statusColor =
    brief.status === 'completed'
      ? colors.statusComplete
      : brief.status === 'in_progress'
        ? colors.statusRunning
        : colors.statusError

  const statusBgColor =
    brief.status === 'completed'
      ? colors.statusCompleteBg
      : brief.status === 'in_progress'
        ? colors.statusRunningBg
        : colors.statusErrorBg

  const fileCount = brief.filesTouched.length

  return (
    <motion.div
      data-testid="resume-brief"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="rounded-lg px-3 py-2.5 mb-2 relative"
      style={{
        background: colors.surfacePrimary,
        border: `1px solid ${colors.containerBorder}`,
      }}
    >
      {/* Dismiss button */}
      <button
        data-testid="resume-brief-dismiss"
        onClick={onDismiss}
        className="absolute top-2 right-2 rounded-md p-0.5 transition-colors"
        style={{ color: colors.textTertiary, background: 'transparent' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = colors.surfaceHover }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        title="Dismiss"
      >
        <X size={12} />
      </button>

      {/* Header: icon + "Where you left off" */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <ClockCounterClockwise size={13} style={{ color: colors.accent }} />
        <span className="text-[12px] font-medium" style={{ color: colors.textSecondary }}>
          Where you left off
        </span>
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-[1px] rounded-full"
          style={{ background: statusBgColor, color: statusColor }}
        >
          {brief.status === 'completed' && <Check size={9} weight="bold" />}
          {STATUS_LABELS[brief.status]}
        </span>
        <span className="text-[10px]" style={{ color: colors.textTertiary }}>
          {brief.messageCount} messages
        </span>
      </div>

      {/* Last task */}
      <div
        className="text-[12px] leading-[1.5] mb-1.5"
        style={{ color: colors.textPrimary }}
        data-testid="resume-brief-task"
      >
        {brief.lastTask}
      </div>

      {/* Files touched */}
      {fileCount > 0 && (
        <div className="mb-2">
          <button
            data-testid="resume-brief-files-toggle"
            onClick={() => setFilesExpanded(!filesExpanded)}
            className="flex items-center gap-1 text-[11px] transition-colors"
            style={{ color: colors.textTertiary, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            {filesExpanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
            <FileText size={11} />
            <span>{fileCount} file{fileCount !== 1 ? 's' : ''} touched</span>
          </button>

          {filesExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.15 }}
              className="mt-1 pl-5 space-y-0.5 overflow-hidden"
            >
              {brief.filesTouched.map((filePath) => (
                <div
                  key={filePath}
                  className="text-[10px] truncate"
                  style={{ color: colors.textTertiary }}
                  title={filePath}
                >
                  {filePath}
                </div>
              ))}
            </motion.div>
          )}
        </div>
      )}

      {/* Catch me up button */}
      <button
        data-testid="resume-brief-catch-up"
        onClick={onCatchMeUp}
        className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md transition-colors"
        style={{
          background: colors.accentSoft,
          color: colors.accent,
          border: 'none',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = colors.accentLight }}
        onMouseLeave={(e) => { e.currentTarget.style.background = colors.accentSoft }}
      >
        <ClockCounterClockwise size={12} />
        Catch me up
      </button>
    </motion.div>
  )
}
