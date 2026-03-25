/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

// ─── Mocks (must be before imports) ───

const mockColors: Record<string, string> = {
  accent: '#d97757',
  accentSoft: 'rgba(217, 119, 87, 0.15)',
  accentBorderMedium: 'rgba(217, 119, 87, 0.25)',
  textPrimary: '#ccc9c0',
  textSecondary: '#c0bdb2',
  textTertiary: '#76766e',
  textMuted: '#353530',
  surfaceHover: 'rgba(255, 255, 255, 0.05)',
  surfacePrimary: '#353530',
  toolBg: '#353530',
  toolBorder: '#4a4a45',
  toolRunningBorder: 'rgba(217, 119, 87, 0.3)',
  toolRunningBg: 'rgba(217, 119, 87, 0.05)',
  statusError: '#c47060',
  statusErrorBg: 'rgba(196, 112, 96, 0.08)',
  statusComplete: '#7aac8c',
  statusCompleteBg: 'rgba(122, 172, 140, 0.1)',
  statusRunning: '#d97757',
  timelineLine: '#353530',
  codeBg: '#1a1a18',
  containerBorder: '#3b3b36',
  cardShadow: '0 2px 8px rgba(0,0,0,0.35)',
}

vi.mock('../../theme', () => ({
  useColors: () => mockColors,
  useThemeStore: (selector: any) => {
    const state = { isDark: true, expandedUI: false }
    return selector ? selector(state) : state
  },
}))

vi.mock('../FilePath', () => ({
  FilePath: ({ path }: any) => React.createElement('span', null, path),
}))

vi.mock('../DiffViewer', () => ({
  DiffViewer: () => React.createElement('div', { 'data-testid': 'diff-viewer' }),
}))

vi.mock('../ToolBlockSummary', () => ({
  CollapsibleToolOutput: () => React.createElement('div', { 'data-testid': 'collapsible-output' }),
}))

import type { Message } from '../../../shared/types'
import { ToolTimeline } from '../ToolTimeline'

// ─── Helpers ───

function makeToolMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: `tool-${Math.random().toString(36).slice(2)}`,
    role: 'tool',
    content: '',
    timestamp: Date.now(),
    toolName: 'Read',
    toolStatus: 'completed',
    toolInput: JSON.stringify({ file_path: '/src/index.ts' }),
    ...overrides,
  }
}

// ─── Tests ───

describe('ToolTimeline Redesign', () => {
  it('renders pill icons at 16px', () => {
    const tools = [
      makeToolMsg({ toolName: 'Read', toolStatus: 'running' }),
    ]
    render(<ToolTimeline tools={tools} skipMotion />)
    const pills = screen.getAllByTestId('tool-pill')
    expect(pills.length).toBe(1)
    const svg = pills[0].querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg!.getAttribute('width')).toBe('16')
  })

  it('running tool pill has pulse animation class', () => {
    const tools = [
      makeToolMsg({ toolName: 'Bash', toolStatus: 'running', toolInput: JSON.stringify({ command: 'npm test' }) }),
    ]
    render(<ToolTimeline tools={tools} skipMotion />)
    const pills = screen.getAllByTestId('tool-pill')
    expect(pills[0].className).toContain('tool-pulse')
  })

  it('collapsed state icons are 16px', () => {
    const tools = [
      makeToolMsg({ toolName: 'Read', toolStatus: 'completed' }),
      makeToolMsg({ toolName: 'Edit', toolStatus: 'completed', toolInput: JSON.stringify({ file_path: '/src/app.ts' }) }),
    ]
    render(<ToolTimeline tools={tools} skipMotion />)
    const collapsed = screen.getByTestId('tool-timeline-collapsed')
    const svgs = collapsed.querySelectorAll('svg')
    const toolIcons = Array.from(svgs).filter(s => s.getAttribute('width') === '16')
    expect(toolIcons.length).toBeGreaterThanOrEqual(2)
  })

  it('collapsed state has card-like container styling', () => {
    const tools = [
      makeToolMsg({ toolName: 'Read', toolStatus: 'completed' }),
    ]
    render(<ToolTimeline tools={tools} skipMotion />)
    const collapsed = screen.getByTestId('tool-timeline-collapsed')
    expect(collapsed.className).toContain('rounded-lg')
    expect(collapsed.className).toContain('p-2')
  })

  it('expanded pill detail panel renders after click', async () => {
    const tools = [
      makeToolMsg({ toolName: 'Read', toolStatus: 'completed' }),
    ]
    render(<ToolTimeline tools={tools} skipMotion />)
    // First expand the timeline
    const collapsed = screen.getByTestId('tool-timeline-collapsed')
    await act(async () => {
      fireEvent.click(collapsed)
    })
    // Now click the pill
    const pill = screen.getByTestId('tool-pill')
    await act(async () => {
      fireEvent.click(pill)
    })
    const detail = screen.getByTestId('tool-pill-detail')
    expect(detail).toBeTruthy()
  })

  it('pill labels show full filename not truncated', () => {
    const tools = [
      makeToolMsg({
        toolName: 'Read',
        toolStatus: 'running',
        toolInput: JSON.stringify({ file_path: '/src/components/MyComponent.tsx' }),
      }),
    ]
    render(<ToolTimeline tools={tools} skipMotion />)
    const pill = screen.getByTestId('tool-pill')
    expect(pill.textContent).toContain('MyComponent.tsx')
  })
})
