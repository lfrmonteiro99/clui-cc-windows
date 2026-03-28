/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

// ─── Mocks ───

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

import type { Message } from '../../../shared/types'

// ─── Import summary logic ───

import {
  getToolSummary,
  shouldAutoCollapse,
  getCollapsedPreviewLines,
  getToolTypeInfo,
} from '../ToolBlockSummary'

// ─── Helper ───

function makeToolMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: `tool-${Math.random().toString(36).slice(2)}`,
    role: 'tool',
    content: '',
    timestamp: Date.now(),
    toolName: 'Bash',
    toolStatus: 'completed',
    ...overrides,
  }
}

function makeLongContent(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join('\n')
}

// ─── Tests ───

describe('ToolBlockSummary', () => {
  describe('getToolTypeInfo', () => {
    it('returns Terminal icon name for Bash tool', () => {
      const info = getToolTypeInfo('Bash')
      expect(info.iconName).toBe('Terminal')
    })

    it('returns FileText icon name for Read tool', () => {
      const info = getToolTypeInfo('Read')
      expect(info.iconName).toBe('FileText')
    })

    it('returns FileText icon name for file_read tool', () => {
      const info = getToolTypeInfo('file_read')
      expect(info.iconName).toBe('FileText')
    })

    it('returns PencilSimple icon name for Edit tool', () => {
      const info = getToolTypeInfo('Edit')
      expect(info.iconName).toBe('PencilSimple')
    })

    it('returns PencilSimple icon name for Write tool', () => {
      const info = getToolTypeInfo('Write')
      expect(info.iconName).toBe('PencilSimple')
    })

    it('returns PencilSimple icon name for file_edit tool', () => {
      const info = getToolTypeInfo('file_edit')
      expect(info.iconName).toBe('PencilSimple')
    })

    it('returns MagnifyingGlass icon name for Grep tool', () => {
      const info = getToolTypeInfo('Grep')
      expect(info.iconName).toBe('MagnifyingGlass')
    })

    it('returns MagnifyingGlass icon name for Glob tool', () => {
      const info = getToolTypeInfo('Glob')
      expect(info.iconName).toBe('MagnifyingGlass')
    })

    it('returns MagnifyingGlass icon name for Search tool', () => {
      const info = getToolTypeInfo('Search')
      expect(info.iconName).toBe('MagnifyingGlass')
    })
  })

  describe('getToolSummary', () => {
    it('generates bash summary with command and exit code', () => {
      const summary = getToolSummary(
        'Bash',
        JSON.stringify({ command: 'npm test' }),
        'Tests passed\nexit code 0',
      )
      expect(summary).toContain('$')
      expect(summary).toContain('npm test')
    })

    it('generates Read summary with path and line count', () => {
      const content = makeLongContent(25)
      const summary = getToolSummary(
        'Read',
        JSON.stringify({ file_path: '/src/index.ts' }),
        content,
      )
      expect(summary).toContain('Read')
      expect(summary).toContain('index.ts')
      expect(summary).toContain('25 lines')
    })

    it('generates Edit summary with path and diff stats', () => {
      const summary = getToolSummary(
        'Edit',
        JSON.stringify({ file_path: '/src/app.ts', old_string: 'foo\nbar', new_string: 'baz\nqux\nextra' }),
        'Edited file',
      )
      expect(summary).toContain('Editing')
      expect(summary).toContain('app.ts')
    })

    it('generates Search/Grep summary', () => {
      const summary = getToolSummary(
        'Grep',
        JSON.stringify({ pattern: 'TODO' }),
        'src/a.ts:10: TODO fix\nsrc/b.ts:20: TODO clean',
      )
      expect(summary).toContain('TODO')
    })
  })

  describe('shouldAutoCollapse', () => {
    it('returns false for content with 15 or fewer lines', () => {
      expect(shouldAutoCollapse(makeLongContent(15))).toBe(false)
    })

    it('returns true for content with more than 15 lines', () => {
      expect(shouldAutoCollapse(makeLongContent(16))).toBe(true)
    })

    it('returns false for empty content', () => {
      expect(shouldAutoCollapse('')).toBe(false)
    })
  })

  describe('getCollapsedPreviewLines', () => {
    it('returns first 5 lines from content', () => {
      const content = makeLongContent(20)
      const preview = getCollapsedPreviewLines(content)
      expect(preview.previewLines).toHaveLength(5)
      expect(preview.previewLines[0]).toBe('line 1')
      expect(preview.previewLines[4]).toBe('line 5')
    })

    it('returns correct remaining line count', () => {
      const content = makeLongContent(20)
      const preview = getCollapsedPreviewLines(content)
      expect(preview.remainingCount).toBe(15)
    })

    it('returns all lines when content has 5 or fewer lines', () => {
      const content = makeLongContent(3)
      const preview = getCollapsedPreviewLines(content)
      expect(preview.previewLines).toHaveLength(3)
      expect(preview.remainingCount).toBe(0)
    })
  })
})

describe('CollapsibleToolOutput (rendered)', () => {
  // Dynamically import after mocks
  let CollapsibleToolOutput: React.ComponentType<any>

  beforeEach(async () => {
    const mod = await import('../ToolBlockSummary')
    CollapsibleToolOutput = mod.CollapsibleToolOutput
  })

  it('auto-collapses output with >15 lines', () => {
    const content = makeLongContent(20)
    render(
      <CollapsibleToolOutput
        toolName="Bash"
        toolInput={JSON.stringify({ command: 'ls -la' })}
        content={content}
        toolStatus="completed"
      />,
    )
    // Should show "Show N more lines" button
    expect(screen.getByTestId('show-more-btn')).toBeTruthy()
    expect(screen.getByTestId('show-more-btn').textContent).toContain('15')
  })

  it('shows first 5 lines when collapsed', () => {
    const content = makeLongContent(20)
    render(
      <CollapsibleToolOutput
        toolName="Bash"
        toolInput={JSON.stringify({ command: 'ls -la' })}
        content={content}
        toolStatus="completed"
      />,
    )
    const preview = screen.getByTestId('tool-output-preview')
    expect(preview.textContent).toContain('line 1')
    expect(preview.textContent).toContain('line 5')
    expect(preview.textContent).not.toContain('line 6')
  })

  it('does not auto-collapse output with <=15 lines', () => {
    const content = makeLongContent(10)
    render(
      <CollapsibleToolOutput
        toolName="Read"
        toolInput={JSON.stringify({ file_path: '/foo.ts' })}
        content={content}
        toolStatus="completed"
      />,
    )
    expect(screen.queryByTestId('show-more-btn')).toBeNull()
  })

  it('expands on click and shows all content', () => {
    const content = makeLongContent(20)
    render(
      <CollapsibleToolOutput
        toolName="Bash"
        toolInput={JSON.stringify({ command: 'test' })}
        content={content}
        toolStatus="completed"
      />,
    )
    const btn = screen.getByTestId('show-more-btn')
    fireEvent.click(btn)
    // After expand, the full content should be visible
    const fullOutput = screen.getByTestId('tool-output-full')
    expect(fullOutput.textContent).toContain('line 20')
    // And a collapse button should appear
    expect(screen.getByTestId('show-less-btn')).toBeTruthy()
  })

  it('each block has independent expand/collapse', () => {
    const content1 = makeLongContent(20)
    const content2 = makeLongContent(25)
    const { container } = render(
      <div>
        <CollapsibleToolOutput
          toolName="Bash"
          toolInput={JSON.stringify({ command: 'cmd1' })}
          content={content1}
          toolStatus="completed"
        />
        <CollapsibleToolOutput
          toolName="Read"
          toolInput={JSON.stringify({ file_path: '/x.ts' })}
          content={content2}
          toolStatus="completed"
        />
      </div>,
    )
    const showMoreBtns = screen.getAllByTestId('show-more-btn')
    expect(showMoreBtns).toHaveLength(2)

    // Expand first, second should remain collapsed
    fireEvent.click(showMoreBtns[0])
    const fullOutputs = screen.getAllByTestId('tool-output-full')
    expect(fullOutputs).toHaveLength(1)
    // Second block still collapsed
    expect(screen.getAllByTestId('show-more-btn')).toHaveLength(1)
  })

  it('shows correct icon name in summary header for Bash', () => {
    const content = makeLongContent(20)
    render(
      <CollapsibleToolOutput
        toolName="Bash"
        toolInput={JSON.stringify({ command: 'npm run build' })}
        content={content}
        toolStatus="completed"
      />,
    )
    const header = screen.getByTestId('tool-block-header')
    expect(header.textContent).toContain('$')
    expect(header.textContent).toContain('npm run build')
  })

  it('shows correct icon for Read tool', () => {
    render(
      <CollapsibleToolOutput
        toolName="Read"
        toolInput={JSON.stringify({ file_path: '/src/types.ts' })}
        content={makeLongContent(20)}
        toolStatus="completed"
      />,
    )
    const header = screen.getByTestId('tool-block-header')
    expect(header.textContent).toContain('Read')
    expect(header.textContent).toContain('types.ts')
  })
})
