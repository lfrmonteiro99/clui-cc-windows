import React, { useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TerminalWindow, CheckCircle, XCircle } from '@phosphor-icons/react'
import { useTerminalStore } from '../stores/terminalStore'
import { useColors } from '../theme'

export function TabOverview() {
  const overviewOpen = useTerminalStore((s) => s.overviewOpen)
  const termTabs = useTerminalStore((s) => s.termTabs)
  const selectTabFromOverview = useTerminalStore((s) => s.selectTabFromOverview)
  const setTabOverviewOpen = useTerminalStore((s) => s.setTabOverviewOpen)
  const colors = useColors()
  const focusedRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setTabOverviewOpen(false), [setTabOverviewOpen])

  useEffect(() => {
    if (!overviewOpen) return

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        const tab = termTabs[focusedRef.current]
        if (tab) selectTabFromOverview(tab.id)
        return
      }

      // Arrow navigation
      const cols = Math.min(termTabs.length, 4)
      if (e.key === 'ArrowRight') {
        focusedRef.current = Math.min(focusedRef.current + 1, termTabs.length - 1)
      } else if (e.key === 'ArrowLeft') {
        focusedRef.current = Math.max(focusedRef.current - 1, 0)
      } else if (e.key === 'ArrowDown') {
        focusedRef.current = Math.min(focusedRef.current + cols, termTabs.length - 1)
      } else if (e.key === 'ArrowUp') {
        focusedRef.current = Math.max(focusedRef.current - cols, 0)
      }

      // Number keys 1-8 for quick jump
      const num = parseInt(e.key, 10)
      if (num >= 1 && num <= 8 && num <= termTabs.length) {
        selectTabFromOverview(termTabs[num - 1].id)
        return
      }

      // Update focus styling
      containerRef.current?.querySelectorAll('[data-overview-card]').forEach((el, i) => {
        ;(el as HTMLElement).style.outline = i === focusedRef.current ? `2px solid ${colors.accent}` : 'none'
      })
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [overviewOpen, termTabs, selectTabFromOverview, close, colors.accent])

  if (!overviewOpen) return null

  if (termTabs.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={close}
        style={{
          position: 'absolute', inset: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div style={{ color: colors.textTertiary, fontSize: 14 }}>No terminal tabs open</div>
      </motion.div>
    )
  }

  return (
    <AnimatePresence>
      {overviewOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2 }}
          onClick={close}
          style={{
            position: 'absolute', inset: 0, zIndex: 50,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            ref={containerRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(termTabs.length, 4)}, 140px)`,
              gap: 12,
            }}
          >
            {termTabs.map((tab, i) => {
              const isExited = tab.status === 'exited'
              const exitSuccess = isExited && tab.exitCode === 0
              const exitFail = isExited && tab.exitCode !== 0

              return (
                <div
                  key={tab.id}
                  data-overview-card
                  onClick={() => selectTabFromOverview(tab.id)}
                  style={{
                    width: 140,
                    height: 100,
                    background: colors.surfacePrimary,
                    border: `1px solid ${colors.containerBorder}`,
                    borderRadius: 8,
                    padding: 10,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    outline: i === 0 ? `2px solid ${colors.accent}` : 'none',
                    transition: 'outline 0.1s',
                  }}
                >
                  <div className="flex items-center gap-1" style={{ fontSize: 11, fontWeight: 600, color: colors.textPrimary }}>
                    {exitSuccess && <CheckCircle size={12} style={{ color: '#4ade80' }} />}
                    {exitFail && <XCircle size={12} style={{ color: '#f87171' }} />}
                    {!isExited && <TerminalWindow size={12} />}
                    <span className="truncate">{tab.title}</span>
                  </div>
                  <div style={{ fontSize: 10, color: colors.textTertiary }}>
                    {tab.shell}
                  </div>
                  <div className="truncate" style={{ fontSize: 10, color: colors.textMuted }}>
                    {tab.cwd}
                  </div>
                  {isExited && (
                    <span style={{ fontSize: 10, color: exitSuccess ? '#4ade80' : '#f87171' }}>
                      exit {tab.exitCode}
                    </span>
                  )}
                  {!isExited && (
                    <span style={{ fontSize: 10, color: '#4ade80' }}>active</span>
                  )}
                </div>
              )
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
