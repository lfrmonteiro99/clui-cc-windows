import React, { useCallback, useRef, useState } from 'react'
import { TerminalView } from './TerminalView'
import { useColors } from '../theme'
import type { PaneNode } from '../stores/terminalStore'

interface SplitPaneProps {
  layout: PaneNode
  activeTermTabId: string | null
}

export function SplitPane({ layout, activeTermTabId }: SplitPaneProps) {
  if (layout.type === 'leaf') {
    return (
      <TerminalView
        termTabId={layout.termTabId}
        isActive={layout.termTabId === activeTermTabId}
      />
    )
  }

  return (
    <SplitContainer
      direction={layout.direction}
      initialRatio={layout.ratio}
      first={<SplitPane layout={layout.first} activeTermTabId={activeTermTabId} />}
      second={<SplitPane layout={layout.second} activeTermTabId={activeTermTabId} />}
    />
  )
}

interface SplitContainerProps {
  direction: 'horizontal' | 'vertical'
  initialRatio: number
  first: React.ReactNode
  second: React.ReactNode
}

function SplitContainer({ direction, initialRatio, first, second }: SplitContainerProps) {
  const colors = useColors()
  const [ratio, setRatio] = useState(initialRatio)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const isHorizontal = direction === 'horizontal'

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true

    const handleMouseMove = (me: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      let newRatio: number
      if (isHorizontal) {
        newRatio = (me.clientY - rect.top) / rect.height
      } else {
        newRatio = (me.clientX - rect.left) / rect.width
      }
      setRatio(Math.max(0.2, Math.min(0.8, newRatio)))
    }

    const handleMouseUp = () => {
      draggingRef.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [isHorizontal])

  const handleDoubleClick = useCallback(() => {
    setRatio(0.5)
  }, [])

  const firstStyle: React.CSSProperties = isHorizontal
    ? { height: `${ratio * 100}%`, minHeight: 0 }
    : { width: `${ratio * 100}%`, minWidth: 0 }

  const secondStyle: React.CSSProperties = isHorizontal
    ? { height: `${(1 - ratio) * 100}%`, minHeight: 0 }
    : { width: `${(1 - ratio) * 100}%`, minWidth: 0 }

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'column' : 'row',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div style={{ ...firstStyle, display: 'flex', overflow: 'hidden' }}>
        {first}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        style={{
          [isHorizontal ? 'height' : 'width']: 4,
          [isHorizontal ? 'width' : 'height']: '100%',
          cursor: isHorizontal ? 'row-resize' : 'col-resize',
          background: 'transparent',
          flexShrink: 0,
          position: 'relative',
          // 6px hit target
          padding: isHorizontal ? '1px 0' : '0 1px',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            background: colors.containerBorder,
            borderRadius: 2,
            transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = colors.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.background = colors.containerBorder)}
        />
      </div>

      <div style={{ ...secondStyle, display: 'flex', overflow: 'hidden' }}>
        {second}
      </div>
    </div>
  )
}
