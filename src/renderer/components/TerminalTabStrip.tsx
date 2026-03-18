import React from 'react'
import { Plus, X, TerminalWindow } from '@phosphor-icons/react'
import { useTerminalStore } from '../stores/terminalStore'
import { useColors } from '../theme'

export function TerminalTabStrip() {
  const termTabs = useTerminalStore((s) => s.termTabs)
  const activeTermTabId = useTerminalStore((s) => s.activeTermTabId)
  const setActiveTermTab = useTerminalStore((s) => s.setActiveTermTab)
  const createTermTab = useTerminalStore((s) => s.createTermTab)
  const closeTermTab = useTerminalStore((s) => s.closeTermTab)
  const colors = useColors()

  return (
    <div
      data-clui-ui
      className="flex items-center no-drag"
      style={{
        height: 36,
        padding: '0 8px',
        borderBottom: `1px solid ${colors.containerBorder}`,
        gap: 2,
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}
    >
      {termTabs.map((tab) => {
        const isActive = tab.id === activeTermTabId
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTermTab(tab.id)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] flex-shrink-0 border-0 cursor-pointer"
            style={{
              background: isActive ? colors.tabActive : 'transparent',
              color: isActive ? colors.textPrimary : colors.textTertiary,
              border: isActive ? `1px solid ${colors.tabActiveBorder}` : '1px solid transparent',
              transition: 'background 0.1s, color 0.1s',
            }}
          >
            <TerminalWindow size={12} weight={isActive ? 'fill' : 'regular'} />
            <span className="truncate" style={{ maxWidth: 100 }}>
              {tab.title}
              {tab.status === 'exited' && ` [${tab.exitCode}]`}
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation()
                closeTermTab(tab.id)
              }}
              className="flex items-center justify-center rounded-full hover:bg-white/10"
              style={{ width: 14, height: 14, cursor: 'pointer' }}
            >
              <X size={9} />
            </span>
          </button>
        )
      })}

      {/* New terminal tab button */}
      <button
        onClick={() => createTermTab()}
        className="flex items-center justify-center rounded-full flex-shrink-0 border-0 cursor-pointer"
        style={{
          width: 22,
          height: 22,
          background: 'transparent',
          color: colors.textTertiary,
        }}
        title="New terminal tab"
      >
        <Plus size={12} />
      </button>
    </div>
  )
}
