// @vitest-environment jsdom

import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShellOutput } from '../../../src/renderer/components/ShellOutput'
import type { ShellOutput as ShellOutputType } from '../../../src/shared/types'

// Mock Phosphor icons
vi.mock('@phosphor-icons/react', () => ({
  Terminal: (props: Record<string, unknown>) => React.createElement('span', { 'data-testid': 'terminal-icon', ...props }),
}))

// Mock theme
vi.mock('../../../src/renderer/theme', () => ({
  useColors: () => ({
    codeBg: '#1a1a18',
    textPrimary: '#ccc9c0',
    textTertiary: '#76766e',
    statusError: '#c47060',
  }),
  useThemeStore: { getState: () => ({ isDark: true }), subscribe: vi.fn() },
}))

function makeOutput(overrides: Partial<ShellOutputType> = {}): ShellOutputType {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    truncated: false,
    command: 'echo hello',
    durationMs: 42,
    ...overrides,
  }
}

describe('ShellOutput', () => {
  it('renders stdout in the component', () => {
    render(<ShellOutput output={makeOutput({ stdout: 'hello world\n' })} />)
    expect(screen.getByTestId('shell-stdout')).toHaveTextContent('hello world')
  })

  it('renders stderr', () => {
    render(<ShellOutput output={makeOutput({ stderr: 'something failed', exitCode: 1 })} />)
    expect(screen.getByTestId('shell-stderr')).toHaveTextContent('something failed')
  })

  it('shows exit code and duration in header', () => {
    render(<ShellOutput output={makeOutput({ exitCode: 0, durationMs: 150 })} />)
    const container = screen.getByTestId('shell-output')
    expect(container.textContent).toContain('exit 0')
    expect(container.textContent).toContain('150ms')
  })

  it('shows truncation message when truncated', () => {
    render(<ShellOutput output={makeOutput({ truncated: true, stdout: 'data...' })} />)
    expect(screen.getByTestId('shell-truncated')).toBeInTheDocument()
  })

  it('does not show truncation notice when not truncated', () => {
    render(<ShellOutput output={makeOutput({ truncated: false })} />)
    expect(screen.queryByTestId('shell-truncated')).not.toBeInTheDocument()
  })

  it('shows command in header', () => {
    render(<ShellOutput output={makeOutput({ command: 'git status' })} />)
    const container = screen.getByTestId('shell-output')
    expect(container.textContent).toContain('git status')
  })

  it('formats duration in seconds for long commands', () => {
    render(<ShellOutput output={makeOutput({ durationMs: 2500 })} />)
    const container = screen.getByTestId('shell-output')
    expect(container.textContent).toContain('2.5s')
  })
})
