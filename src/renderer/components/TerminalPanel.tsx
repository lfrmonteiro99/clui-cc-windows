import React, { useEffect } from 'react'
import { TerminalTabStrip } from './TerminalTabStrip'
import { TerminalView } from './TerminalView'
import { TerminalStatusBar } from './TerminalStatusBar'
import { useTerminalStore } from '../stores/terminalStore'
import { useColors } from '../theme'

export function TerminalPanel() {
  const termTabs = useTerminalStore((s) => s.termTabs)
  const activeTermTabId = useTerminalStore((s) => s.activeTermTabId)
  const createTermTab = useTerminalStore((s) => s.createTermTab)
  const handleTerminalExit = useTerminalStore((s) => s.handleTerminalExit)
  const colors = useColors()

  // Auto-create first terminal tab when panel mounts with no tabs
  useEffect(() => {
    if (termTabs.length === 0) {
      createTermTab()
    }
  }, [])

  // Listen for terminal exit events
  useEffect(() => {
    const unsub = window.clui.onTerminalExit((termTabId, exitCode) => {
      handleTerminalExit(termTabId, exitCode)
    })
    return unsub
  }, [handleTerminalExit])

  const activeTab = termTabs.find((t) => t.id === activeTermTabId)

  return (
    <div
      data-clui-ui
      className="flex flex-col"
      style={{ height: '100%', minHeight: 0 }}
    >
      <TerminalTabStrip />

      {/* Terminal views — all mounted, only active visible */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {termTabs.map((tab) => (
          <TerminalView
            key={tab.id}
            termTabId={tab.id}
            isActive={tab.id === activeTermTabId}
          />
        ))}

        {termTabs.length === 0 && (
          <div
            className="flex items-center justify-center h-full text-[13px]"
            style={{ color: colors.textTertiary }}
          >
            No terminal tabs open
          </div>
        )}
      </div>

      <TerminalStatusBar activeTab={activeTab ?? null} />
    </div>
  )
}
