// @vitest-environment jsdom

import React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResumeBrief } from '../../../src/renderer/components/ResumeBrief'
import type { ResumeBrief as ResumeBriefData } from '../../../src/shared/session-resume'
import { renderWithProviders, resetTestState } from '../testUtils'

function makeBrief(overrides: Partial<ResumeBriefData> = {}): ResumeBriefData {
  return {
    lastTask: 'Implemented the login feature and added tests.',
    filesTouched: ['/src/auth.ts', '/src/auth.test.ts'],
    status: 'completed',
    lastActivityAt: Date.now() - 30 * 60 * 1000,
    messageCount: 12,
    ...overrides,
  }
}

describe('ResumeBrief', () => {
  beforeEach(() => {
    resetTestState()
  })

  it('renders the resume brief card with last task text', () => {
    const brief = makeBrief()
    renderWithProviders(
      <ResumeBrief brief={brief} onCatchMeUp={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(screen.getByTestId('resume-brief')).toBeInTheDocument()
    expect(screen.getByTestId('resume-brief-task')).toHaveTextContent(
      'Implemented the login feature and added tests.',
    )
  })

  it('shows the "Where you left off" header', () => {
    renderWithProviders(
      <ResumeBrief brief={makeBrief()} onCatchMeUp={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(screen.getByText('Where you left off')).toBeInTheDocument()
  })

  it('displays the correct status badge for completed', () => {
    renderWithProviders(
      <ResumeBrief brief={makeBrief({ status: 'completed' })} onCatchMeUp={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('displays the correct status badge for in_progress', () => {
    renderWithProviders(
      <ResumeBrief brief={makeBrief({ status: 'in_progress' })} onCatchMeUp={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(screen.getByText('In progress')).toBeInTheDocument()
  })

  it('displays the correct status badge for interrupted', () => {
    renderWithProviders(
      <ResumeBrief brief={makeBrief({ status: 'interrupted' })} onCatchMeUp={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(screen.getByText('Interrupted')).toBeInTheDocument()
  })

  it('shows message count', () => {
    renderWithProviders(
      <ResumeBrief brief={makeBrief({ messageCount: 42 })} onCatchMeUp={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(screen.getByText('42 messages')).toBeInTheDocument()
  })

  it('shows file count and expands file list on click', () => {
    const brief = makeBrief({ filesTouched: ['/src/a.ts', '/src/b.ts', '/src/c.ts'] })
    renderWithProviders(
      <ResumeBrief brief={brief} onCatchMeUp={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(screen.getByText('3 files touched')).toBeInTheDocument()

    // Files should not be visible initially
    expect(screen.queryByText('/src/a.ts')).not.toBeInTheDocument()

    // Click to expand
    fireEvent.click(screen.getByTestId('resume-brief-files-toggle'))

    expect(screen.getByText('/src/a.ts')).toBeInTheDocument()
    expect(screen.getByText('/src/b.ts')).toBeInTheDocument()
    expect(screen.getByText('/src/c.ts')).toBeInTheDocument()
  })

  it('does not show file section when no files touched', () => {
    renderWithProviders(
      <ResumeBrief brief={makeBrief({ filesTouched: [] })} onCatchMeUp={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(screen.queryByText(/files? touched/)).not.toBeInTheDocument()
  })

  it('uses singular "file" when exactly one file touched', () => {
    renderWithProviders(
      <ResumeBrief brief={makeBrief({ filesTouched: ['/src/one.ts'] })} onCatchMeUp={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(screen.getByText('1 file touched')).toBeInTheDocument()
  })

  it('calls onCatchMeUp when "Catch me up" button is clicked', () => {
    const onCatchMeUp = vi.fn()
    renderWithProviders(
      <ResumeBrief brief={makeBrief()} onCatchMeUp={onCatchMeUp} onDismiss={vi.fn()} />,
    )

    fireEvent.click(screen.getByTestId('resume-brief-catch-up'))

    expect(onCatchMeUp).toHaveBeenCalledOnce()
  })

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn()
    renderWithProviders(
      <ResumeBrief brief={makeBrief()} onCatchMeUp={vi.fn()} onDismiss={onDismiss} />,
    )

    fireEvent.click(screen.getByTestId('resume-brief-dismiss'))

    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
