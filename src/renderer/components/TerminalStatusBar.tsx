import React from 'react'
import { ChatCircle, TerminalWindow } from '@phosphor-icons/react'
import { useTerminalStore } from '../stores/terminalStore'
import { useColors } from '../theme'
import type { TerminalTab } from '../../shared/types'

interface Props {
  activeTab: TerminalTab | null
}

export function TerminalStatusBar({ activeTab }: Props) {
  const toggleMode = useTerminalStore((s) => s.toggleMode)
  const colors = useColors()

  return (
    <div
      data-clui-ui
      className="flex items-center no-drag"
      style={{
        height: 28,
        minHeight: 28,
        padding: '0 8px',
        borderTop: `1px solid ${colors.containerBorder}`,
        background: colors.surfaceHover,
        gap: 8,
      }}
    >
      {/* Back to chat button */}
      <button
        onClick={toggleMode}
        className="flex items-center gap-1 border-0 cursor-pointer rounded px-1.5 py-0.5"
        style={{
          background: 'transparent',
          color: colors.textTertiary,
          fontSize: 11,
          transition: 'color 0.1s',
        }}
        title="Switch to Chat"
        onMouseEnter={(e) => (e.currentTarget.style.color = colors.accent)}
        onMouseLeave={(e) => (e.currentTarget.style.color = colors.textTertiary)}
      >
        <ChatCircle size={12} />
        <span>Chat</span>
      </button>

      {/* Divider */}
      <div style={{ width: 1, height: 16, background: colors.containerBorder }} />

      {activeTab && (
        <>
          {/* Shell info */}
          <div className="flex items-center gap-1" style={{ color: colors.textTertiary, fontSize: 11 }}>
            <TerminalWindow size={11} />
            <span>{activeTab.title}</span>
          </div>

          {/* CWD */}
          <div
            className="truncate"
            style={{
              color: colors.textTertiary,
              fontSize: 11,
              maxWidth: '50%',
              direction: 'rtl',
              textAlign: 'left',
            }}
          >
            {activeTab.cwd}
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Status */}
          {activeTab.status === 'exited' && (
            <span style={{ color: colors.statusError, fontSize: 11 }}>
              exited ({activeTab.exitCode})
            </span>
          )}
        </>
      )}
    </div>
  )
}
