import React from 'react'
import { Terminal as TerminalIcon } from '@phosphor-icons/react'
import { useTerminalStore } from '../stores/terminalStore'
import { useColors } from '../theme'

export function ModeToggle() {
  const terminalMode = useTerminalStore((s) => s.terminalMode)
  const toggleMode = useTerminalStore((s) => s.toggleMode)
  const colors = useColors()

  return (
    <button
      className="stack-btn glass-surface"
      title={terminalMode ? 'Switch to Chat (Ctrl+`)' : 'Terminal (Ctrl+`)'}
      onClick={toggleMode}
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        cursor: 'pointer',
        background: terminalMode ? colors.accent : undefined,
        color: terminalMode ? colors.textOnAccent : colors.textSecondary,
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      <TerminalIcon size={17} weight={terminalMode ? 'fill' : 'regular'} />
    </button>
  )
}
