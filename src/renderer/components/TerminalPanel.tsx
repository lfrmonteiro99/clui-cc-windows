import React, { useEffect, useRef, useState } from 'react'
import { ClockCounterClockwise, X } from '@phosphor-icons/react'
import { TerminalTabStrip } from './TerminalTabStrip'
import { TerminalView } from './TerminalView'
import { TerminalStatusBar } from './TerminalStatusBar'
import { TerminalSettings } from './TerminalSettings'
import { TabOverview } from './TabOverview'
import { SplitPane } from './SplitPane'
import { useTerminalStore } from '../stores/terminalStore'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../theme'

export function TerminalPanel() {
  const termTabs = useTerminalStore((s) => s.termTabs)
  const activeTermTabId = useTerminalStore((s) => s.activeTermTabId)
  const createTermTab = useTerminalStore((s) => s.createTermTab)
  const handleTerminalExit = useTerminalStore((s) => s.handleTerminalExit)
  const ptyAvailable = useTerminalStore((s) => s.ptyAvailable)
  const paneLayouts = useTerminalStore((s) => s.paneLayouts)
  const persistedSessions = useTerminalStore((s) => s.persistedSessions)
  const loadPersistedSessions = useTerminalStore((s) => s.loadPersistedSessions)
  const restoreSession = useTerminalStore((s) => s.restoreSession)
  const dismissAllPersistedSessions = useTerminalStore((s) => s.dismissAllPersistedSessions)
  const colors = useColors()
  const [error, setError] = useState<string | null>(null)

  // TERM-007: Load persisted sessions on mount
  useEffect(() => {
    if (ptyAvailable) {
      loadPersistedSessions()
    }
  }, [ptyAvailable])

  // Auto-create first terminal tab using chat's working directory
  useEffect(() => {
    if (termTabs.length === 0 && ptyAvailable) {
      const chatTab = useSessionStore.getState().tabs.find(
        (t) => t.id === useSessionStore.getState().activeTabId,
      )
      const cwd = chatTab?.workingDirectory || undefined
      createTermTab({ cwd }).catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
    }
  }, [ptyAvailable])

  // Listen for terminal exit events
  useEffect(() => {
    const unsub = window.clui.onTerminalExit((termTabId, exitCode) => {
      handleTerminalExit(termTabId, exitCode)
    })
    return unsub
  }, [handleTerminalExit])

  // Listen for terminal shortcuts from TerminalView customKeyEventHandler
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail?.action) return
      const store = useTerminalStore.getState()

      switch (detail.action) {
        case 'new-tab': {
          const chatTab = useSessionStore.getState().tabs.find(
            (t) => t.id === useSessionStore.getState().activeTabId,
          )
          store.createTermTab({ cwd: chatTab?.workingDirectory }).catch(() => {})
          break
        }
        case 'close-tab':
          if (store.activeTermTabId) store.closeTermTab(store.activeTermTabId)
          break
        // TERM-002: Close split pane or close tab if no split
        case 'close-pane-or-tab': {
          const paneTermTabId = detail.termTabId
          if (!paneTermTabId) break
          // Find the parent tab that owns this pane
          const parentTabId = Object.keys(store.paneLayouts).find((tabId) => {
            const layout = store.paneLayouts[tabId]
            if (!layout || layout.type === 'leaf') return false
            // Check if this termTabId is a leaf in this layout
            const findLeaf = (node: any): boolean => {
              if (node.type === 'leaf') return node.termTabId === paneTermTabId
              return findLeaf(node.first) || findLeaf(node.second)
            }
            return findLeaf(layout)
          })
          if (parentTabId) {
            store.closeSplitPane(parentTabId, paneTermTabId)
          } else if (store.activeTermTabId) {
            store.closeTermTab(store.activeTermTabId)
          }
          break
        }
        case 'next-tab': {
          const tabs = store.termTabs
          const idx = tabs.findIndex((t) => t.id === store.activeTermTabId)
          if (tabs.length > 1) store.setActiveTermTab(tabs[(idx + 1) % tabs.length].id)
          break
        }
        case 'prev-tab': {
          const tabs = store.termTabs
          const idx = tabs.findIndex((t) => t.id === store.activeTermTabId)
          if (tabs.length > 1) store.setActiveTermTab(tabs[(idx - 1 + tabs.length) % tabs.length].id)
          break
        }
        case 'zoom-in':
          store.setFontSize(store.fontSize + 1)
          break
        case 'zoom-out':
          store.setFontSize(store.fontSize - 1)
          break
        case 'zoom-reset':
          store.setFontSize(13)
          break
        // TERM-002: Split panes
        case 'split-horizontal':
          if (store.activeTermTabId) {
            store.splitPane(store.activeTermTabId, 'horizontal').catch(() => {})
          }
          break
        case 'split-vertical':
          if (store.activeTermTabId) {
            store.splitPane(store.activeTermTabId, 'vertical').catch(() => {})
          }
          break
        // TERM-006: Tab overview
        case 'tab-overview':
          store.setTabOverviewOpen(!store.overviewOpen)
          break
      }
    }
    window.addEventListener('clui-terminal-shortcut', handler)
    return () => window.removeEventListener('clui-terminal-shortcut', handler)
  }, [])

  // Track which terminal tabs have been activated at least once.
  const mountedTermTabs = useRef(new Set<string>())
  if (activeTermTabId) {
    mountedTermTabs.current.add(activeTermTabId)
  }

  const activeTab = termTabs.find((t) => t.id === activeTermTabId)

  // node-pty unavailable state
  if (ptyAvailable === false) {
    return (
      <div
        data-clui-ui
        className="flex items-center justify-center h-full"
        style={{ padding: 24 }}
      >
        <div
          style={{
            width: 320,
            background: colors.surfacePrimary,
            border: `1px solid ${colors.containerBorder}`,
            borderRadius: 12,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: colors.textPrimary, marginBottom: 8 }}>
            Terminal Unavailable
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5, marginBottom: 16 }}>
            The native terminal module (node-pty) could not be loaded.
            Close the app, run <code style={{ color: colors.accent, fontSize: 12 }}>npm rebuild</code>, and restart.
          </div>
          <button
            onClick={() => useTerminalStore.getState().toggleMode()}
            style={{
              background: colors.accent,
              color: colors.textOnAccent,
              border: 'none',
              borderRadius: 6,
              padding: '6px 16px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Back to Chat
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      data-clui-ui
      data-testid="terminal-panel"
      className="flex flex-col"
      style={{ height: '100%', minHeight: 0, position: 'relative' }}
    >
      <TerminalTabStrip />

      {/* Error banner */}
      {error && (
        <div style={{ padding: '8px 12px', fontSize: 12, color: colors.statusError, background: colors.statusErrorBg }}>
          {error}
        </div>
      )}

      {/* TERM-007: Restore persisted sessions banner */}
      {persistedSessions.length > 0 && (
        <div
          data-clui-ui
          className="flex items-center gap-2"
          style={{
            padding: '6px 12px',
            fontSize: 11,
            color: colors.textSecondary,
            background: colors.surfaceHover,
            borderBottom: `1px solid ${colors.containerBorder}`,
          }}
        >
          <ClockCounterClockwise size={14} style={{ color: colors.accent, flexShrink: 0 }} />
          <span>{persistedSessions.length} previous session{persistedSessions.length > 1 ? 's' : ''} available</span>
          <div style={{ flex: 1 }} />
          {persistedSessions.slice(0, 3).map((s) => (
            <button
              key={s.id}
              onClick={() => restoreSession(s.id)}
              className="border-0 cursor-pointer rounded px-2 py-0.5"
              style={{
                fontSize: 10,
                background: colors.accentSoft,
                color: colors.accent,
              }}
              title={`Restore: ${s.shell} (${s.cwd})`}
            >
              {s.cwd.split(/[\\/]/).pop() || s.cwd}
            </button>
          ))}
          <button
            onClick={dismissAllPersistedSessions}
            className="flex items-center justify-center border-0 cursor-pointer rounded-full"
            style={{ width: 18, height: 18, background: 'transparent', color: colors.textMuted }}
            title="Dismiss all"
            aria-label="Dismiss persisted sessions"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* Terminal views */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {termTabs
          .filter((tab) => tab.id === activeTermTabId || mountedTermTabs.current.has(tab.id))
          .map((tab) => {
            const layout = paneLayouts[tab.id]
            const isVisible = tab.id === activeTermTabId

            if (layout) {
              // TERM-002: Split pane layout
              return (
                <div
                  key={tab.id}
                  style={{
                    display: isVisible ? 'flex' : 'none',
                    flex: 1,
                    height: '100%',
                  }}
                >
                  <SplitPane layout={layout} activeTermTabId={activeTermTabId} />
                </div>
              )
            }

            return (
              <TerminalView
                key={tab.id}
                termTabId={tab.id}
                isActive={isVisible}
              />
            )
          })}

        {termTabs.length === 0 && !error && (
          <div
            className="flex items-center justify-center h-full text-[13px]"
            style={{ color: colors.textTertiary }}
          >
            No terminal tabs open
          </div>
        )}

        {/* TERM-006: Tab overview overlay */}
        <TabOverview />
      </div>

      <TerminalStatusBar activeTab={activeTab ?? null} />

      {/* TERM-012: Settings panel */}
      <TerminalSettings />
    </div>
  )
}
