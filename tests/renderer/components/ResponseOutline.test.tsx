// @vitest-environment jsdom

import React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseOutline } from '../../../src/renderer/components/ResponseOutline'
import { renderWithProviders, resetTestState } from '../testUtils'

const CONTENT_3_HEADERS = [
  '## Summary',
  'Some text here.',
  '## Implementation',
  'Details about implementation.',
  '## Testing',
  'Test plan.',
].join('\n')

const CONTENT_2_HEADERS = [
  '## Summary',
  'Some text here.',
  '## Implementation',
  'Details.',
].join('\n')

const CONTENT_WITH_STEPS = [
  '## Summary',
  'Overview.',
  '## Steps',
  '1. First step',
  '2. Second step',
  '3. Third step',
  '## Conclusion',
  'Done.',
].join('\n')

describe('ResponseOutline', () => {
  beforeEach(() => {
    resetTestState()
  })

  it('renders when 3+ headers are present', () => {
    renderWithProviders(
      <ResponseOutline
        content={CONTENT_3_HEADERS}
        isStreaming={true}
        onScrollToOffset={vi.fn()}
      />,
    )

    expect(screen.getByTestId('response-outline')).toBeInTheDocument()
    expect(screen.getByText('Outline')).toBeInTheDocument()
  })

  it('does not render when fewer than 3 headers', () => {
    renderWithProviders(
      <ResponseOutline
        content={CONTENT_2_HEADERS}
        isStreaming={true}
        onScrollToOffset={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('response-outline')).not.toBeInTheDocument()
  })

  it('does not render when no headers', () => {
    renderWithProviders(
      <ResponseOutline
        content="Just plain text with no headers."
        isStreaming={true}
        onScrollToOffset={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('response-outline')).not.toBeInTheDocument()
  })

  it('calls onScrollToOffset when an entry is clicked', () => {
    const onScroll = vi.fn()
    renderWithProviders(
      <ResponseOutline
        content={CONTENT_3_HEADERS}
        isStreaming={true}
        onScrollToOffset={onScroll}
      />,
    )

    const entries = screen.getAllByTestId('outline-entry')
    expect(entries.length).toBe(3)

    fireEvent.click(entries[0])
    expect(onScroll).toHaveBeenCalledTimes(1)
    // First header is at offset 0
    expect(onScroll).toHaveBeenCalledWith(0)
  })

  it('collapses and expands entries on header click', () => {
    renderWithProviders(
      <ResponseOutline
        content={CONTENT_3_HEADERS}
        isStreaming={true}
        onScrollToOffset={vi.fn()}
      />,
    )

    // Entries should be visible initially
    expect(screen.getByTestId('outline-entries')).toBeInTheDocument()

    // Click header to collapse
    fireEvent.click(screen.getByTestId('outline-header'))
    expect(screen.queryByTestId('outline-entries')).not.toBeInTheDocument()

    // Click header again to expand
    fireEvent.click(screen.getByTestId('outline-header'))
    expect(screen.getByTestId('outline-entries')).toBeInTheDocument()
  })

  it('displays step progress when numbered steps are present', () => {
    renderWithProviders(
      <ResponseOutline
        content={CONTENT_WITH_STEPS}
        isStreaming={true}
        onScrollToOffset={vi.fn()}
      />,
    )

    expect(screen.getByTestId('outline-step-progress')).toBeInTheDocument()
    expect(screen.getByTestId('outline-step-progress').textContent).toContain('Step 3')
  })

  it('shows active dot on last entry', () => {
    renderWithProviders(
      <ResponseOutline
        content={CONTENT_3_HEADERS}
        isStreaming={true}
        onScrollToOffset={vi.fn()}
      />,
    )

    const activeDots = screen.getAllByTestId('outline-dot-active')
    expect(activeDots).toHaveLength(1)

    const inactiveDots = screen.getAllByTestId('outline-dot')
    expect(inactiveDots).toHaveLength(2)
  })

  it('renders entry text correctly', () => {
    renderWithProviders(
      <ResponseOutline
        content={CONTENT_3_HEADERS}
        isStreaming={true}
        onScrollToOffset={vi.fn()}
      />,
    )

    expect(screen.getByText('Summary')).toBeInTheDocument()
    expect(screen.getByText('Implementation')).toBeInTheDocument()
    expect(screen.getByText('Testing')).toBeInTheDocument()
  })
})
