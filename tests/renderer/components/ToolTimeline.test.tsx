// @vitest-environment jsdom

import React from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToolTimeline } from '../../../src/renderer/components/ToolTimeline'
import { getToolIcon, getToolLabel, formatDuration } from '../../../src/renderer/components/ToolTimeline'
import { renderWithProviders, resetTestState, makeMessage } from '../testUtils'
import {
  FileText, PencilSimple, Terminal, MagnifyingGlass, Globe,
  ArrowSquareOut, GitBranch, Wrench, FolderOpen, FileArrowUp,
} from '@phosphor-icons/react'

describe('ToolTimeline', () => {
  beforeEach(() => {
    resetTestState()
  })

  // ─── Icon mapping ───

  describe('getToolIcon', () => {
    it('returns FileText for Read tool', () => {
      expect(getToolIcon('Read')).toBe(FileText)
    })

    it('returns PencilSimple for Edit tool', () => {
      expect(getToolIcon('Edit')).toBe(PencilSimple)
    })

    it('returns FileArrowUp for Write tool', () => {
      expect(getToolIcon('Write')).toBe(FileArrowUp)
    })

    it('returns Terminal for Bash tool', () => {
      expect(getToolIcon('Bash')).toBe(Terminal)
    })

    it('returns FolderOpen for Glob tool', () => {
      expect(getToolIcon('Glob')).toBe(FolderOpen)
    })

    it('returns MagnifyingGlass for Grep tool', () => {
      expect(getToolIcon('Grep')).toBe(MagnifyingGlass)
    })

    it('returns Globe for WebSearch tool', () => {
      expect(getToolIcon('WebSearch')).toBe(Globe)
    })

    it('returns ArrowSquareOut for WebFetch tool', () => {
      expect(getToolIcon('WebFetch')).toBe(ArrowSquareOut)
    })

    it('returns Wrench for unknown tool', () => {
      expect(getToolIcon('SomeRandomTool')).toBe(Wrench)
    })

    it('returns GitBranch for Bash git commands', () => {
      const input = JSON.stringify({ command: 'git status' })
      expect(getToolIcon('Bash', input)).toBe(GitBranch)
    })

    it('returns Terminal for non-git Bash commands', () => {
      const input = JSON.stringify({ command: 'npm install' })
      expect(getToolIcon('Bash', input)).toBe(Terminal)
    })
  })

  // ─── Label extraction ───

  describe('getToolLabel', () => {
    it('returns basename for Read tool with file path', () => {
      const input = JSON.stringify({ file_path: '/home/user/src/index.ts' })
      expect(getToolLabel('Read', input)).toBe('index.ts')
    })

    it('returns pattern for Grep tool', () => {
      const input = JSON.stringify({ pattern: 'TODO' })
      expect(getToolLabel('Grep', input)).toBe('TODO')
    })

    it('returns first command word for Bash tool', () => {
      const input = JSON.stringify({ command: 'npm install --save react' })
      expect(getToolLabel('Bash', input)).toBe('npm')
    })

    it('returns git subcommand for git Bash commands', () => {
      const input = JSON.stringify({ command: 'git commit -m "fix"' })
      expect(getToolLabel('Bash', input)).toBe('git commit')
    })

    it('returns tool name when no input', () => {
      expect(getToolLabel('Read')).toBe('Read')
    })

    it('truncates long labels', () => {
      const input = JSON.stringify({ pattern: 'a'.repeat(30) })
      const label = getToolLabel('Grep', input)
      expect(label.length).toBeLessThanOrEqual(30)
    })
  })

  // ─── Duration formatting ───

  describe('formatDuration', () => {
    it('formats milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms')
    })

    it('formats seconds', () => {
      expect(formatDuration(2500)).toBe('2.5s')
    })

    it('formats minutes', () => {
      expect(formatDuration(90000)).toBe('1m 30s')
    })

    it('formats exact minutes', () => {
      expect(formatDuration(120000)).toBe('2m')
    })
  })

  // ─── Collapsed state ───

  describe('collapsed state', () => {
    it('shows tool count and icon strip when collapsed', () => {
      const tools = [
        makeMessage({ role: 'tool', content: 'ok', toolName: 'Read', toolStatus: 'completed', toolInput: JSON.stringify({ file_path: '/a.ts' }) }),
        makeMessage({ role: 'tool', content: 'ok', toolName: 'Edit', toolStatus: 'completed', toolInput: JSON.stringify({ file_path: '/a.ts' }) }),
      ]

      renderWithProviders(<ToolTimeline tools={tools} skipMotion />)

      const collapsed = screen.getByTestId('tool-timeline-collapsed')
      expect(collapsed).toHaveTextContent('2 tools used')
    })

    it('shows singular "tool" for single tool', () => {
      const tools = [
        makeMessage({ role: 'tool', content: 'ok', toolName: 'Read', toolStatus: 'completed' }),
      ]

      renderWithProviders(<ToolTimeline tools={tools} skipMotion />)

      const collapsed = screen.getByTestId('tool-timeline-collapsed')
      expect(collapsed).toHaveTextContent('1 tool used')
    })
  })

  // ─── Expanded state ───

  describe('expanded state', () => {
    it('shows pill strip when expanded', () => {
      const tools = [
        makeMessage({ role: 'tool', content: 'ok', toolName: 'Read', toolStatus: 'completed', toolInput: JSON.stringify({ file_path: '/src/app.ts' }) }),
        makeMessage({ role: 'tool', content: 'ok', toolName: 'Bash', toolStatus: 'completed', toolInput: JSON.stringify({ command: 'npm test' }) }),
      ]

      renderWithProviders(<ToolTimeline tools={tools} skipMotion />)

      // Click to expand
      fireEvent.click(screen.getByTestId('tool-timeline-collapsed'))

      const strip = screen.getByTestId('tool-pill-strip')
      const pills = within(strip).getAllByTestId('tool-pill')
      expect(pills).toHaveLength(2)
      expect(pills[0]).toHaveTextContent('app.ts')
      expect(pills[1]).toHaveTextContent('npm')
    })

    it('can collapse after expanding', () => {
      const tools = [
        makeMessage({ role: 'tool', content: 'ok', toolName: 'Read', toolStatus: 'completed' }),
      ]

      renderWithProviders(<ToolTimeline tools={tools} skipMotion />)

      // Expand
      fireEvent.click(screen.getByTestId('tool-timeline-collapsed'))
      expect(screen.getByTestId('tool-timeline')).toBeInTheDocument()

      // Collapse
      fireEvent.click(screen.getByTestId('tool-timeline-collapse'))
      expect(screen.getByTestId('tool-timeline-collapsed')).toBeInTheDocument()
    })

    it('expands pill detail on click', () => {
      const tools = [
        makeMessage({ role: 'tool', content: 'ok', toolName: 'Grep', toolStatus: 'completed', toolInput: JSON.stringify({ pattern: 'TODO' }) }),
      ]

      renderWithProviders(<ToolTimeline tools={tools} skipMotion />)

      // Expand the timeline
      fireEvent.click(screen.getByTestId('tool-timeline-collapsed'))

      // Click the pill
      const pill = screen.getByTestId('tool-pill')
      fireEvent.click(pill)

      expect(screen.getByTestId('tool-pill-detail')).toBeInTheDocument()
    })

    it('toggles pill detail off on second click', () => {
      const tools = [
        makeMessage({ role: 'tool', content: 'ok', toolName: 'Read', toolStatus: 'completed', toolInput: JSON.stringify({ file_path: '/a.ts' }) }),
      ]

      renderWithProviders(<ToolTimeline tools={tools} skipMotion />)

      fireEvent.click(screen.getByTestId('tool-timeline-collapsed'))

      const pill = screen.getByTestId('tool-pill')
      fireEvent.click(pill)
      expect(screen.getByTestId('tool-pill-detail')).toBeInTheDocument()

      // Click again to close
      fireEvent.click(pill)
      expect(screen.queryByTestId('tool-pill-detail')).not.toBeInTheDocument()
    })
  })

  // ─── Running tools ───

  describe('running tools', () => {
    it('auto-expands when a tool is running', () => {
      const tools = [
        makeMessage({ role: 'tool', content: '', toolName: 'Bash', toolStatus: 'running', toolInput: JSON.stringify({ command: 'npm test' }) }),
      ]

      renderWithProviders(<ToolTimeline tools={tools} skipMotion />)

      // Should be expanded automatically (no collapsed state)
      expect(screen.queryByTestId('tool-timeline-collapsed')).not.toBeInTheDocument()
      expect(screen.getByTestId('tool-pill-strip')).toBeInTheDocument()
    })
  })

  // ─── Duration display ───

  describe('duration display', () => {
    it('shows duration between consecutive tool timestamps', () => {
      const now = Date.now()
      const tools = [
        makeMessage({ role: 'tool', content: 'ok', toolName: 'Read', toolStatus: 'completed', timestamp: now, toolInput: JSON.stringify({ file_path: '/a.ts' }) }),
        makeMessage({ role: 'tool', content: 'ok', toolName: 'Edit', toolStatus: 'completed', timestamp: now + 2500, toolInput: JSON.stringify({ file_path: '/a.ts' }) }),
      ]

      renderWithProviders(<ToolTimeline tools={tools} skipMotion />)

      // Expand
      fireEvent.click(screen.getByTestId('tool-timeline-collapsed'))

      const pills = screen.getAllByTestId('tool-pill')
      // First pill should show duration (2.5s)
      expect(pills[0]).toHaveTextContent('2.5s')
    })
  })

  // ─── Multiple tools ───

  describe('multiple tools', () => {
    it('renders all tools as pills', () => {
      const tools = [
        makeMessage({ role: 'tool', content: 'ok', toolName: 'Read', toolStatus: 'completed', toolInput: JSON.stringify({ file_path: '/a.ts' }) }),
        makeMessage({ role: 'tool', content: 'ok', toolName: 'Grep', toolStatus: 'completed', toolInput: JSON.stringify({ pattern: 'foo' }) }),
        makeMessage({ role: 'tool', content: 'ok', toolName: 'Bash', toolStatus: 'completed', toolInput: JSON.stringify({ command: 'ls' }) }),
        makeMessage({ role: 'tool', content: 'ok', toolName: 'WebSearch', toolStatus: 'completed', toolInput: JSON.stringify({ query: 'react docs' }) }),
      ]

      renderWithProviders(<ToolTimeline tools={tools} skipMotion />)

      // Expand
      fireEvent.click(screen.getByTestId('tool-timeline-collapsed'))

      const pills = screen.getAllByTestId('tool-pill')
      expect(pills).toHaveLength(4)
    })

    it('shows +N indicator in collapsed mode for >6 tools', () => {
      const tools = Array.from({ length: 8 }, (_, i) =>
        makeMessage({ role: 'tool', content: 'ok', toolName: 'Read', toolStatus: 'completed', toolInput: JSON.stringify({ file_path: `/file${i}.ts` }) }),
      )

      renderWithProviders(<ToolTimeline tools={tools} skipMotion />)

      const collapsed = screen.getByTestId('tool-timeline-collapsed')
      expect(collapsed).toHaveTextContent('+2')
    })
  })

  // ─── Error tools ───

  describe('error tools', () => {
    it('renders error pills with error styling', () => {
      const tools = [
        makeMessage({ role: 'tool', content: 'Error: file not found', toolName: 'Read', toolStatus: 'error', toolInput: JSON.stringify({ file_path: '/missing.ts' }) }),
      ]

      renderWithProviders(<ToolTimeline tools={tools} skipMotion />)

      // Expand
      fireEvent.click(screen.getByTestId('tool-timeline-collapsed'))

      const pill = screen.getByTestId('tool-pill')
      expect(pill).toBeInTheDocument()
    })
  })
})
