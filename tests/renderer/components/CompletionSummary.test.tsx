// @vitest-environment jsdom

import React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CompletionSummary } from '../../../src/renderer/components/CompletionSummary'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { makeMessage, makeTab, renderWithProviders, resetTestState } from '../testUtils'

const TAB_ID = 'test-tab-1'

function setupTab(overrides: Parameters<typeof makeTab>[0] = {}) {
  const tab = makeTab({
    id: TAB_ID,
    status: 'completed',
    lastResult: {
      totalCostUsd: 0.042,
      durationMs: 12500,
      numTurns: 3,
      usage: { inputTokens: 5000, outputTokens: 1200, cacheReadTokens: 3000, cacheWriteTokens: 0 },
      sessionId: 'sess-1',
    },
    tokenUsage: {
      inputTokens: 5000,
      outputTokens: 1200,
      totalTokens: 6200,
      cacheReadTokens: 3000,
      cacheWriteTokens: 0,
      lastUpdated: Date.now(),
    },
    messages: [
      makeMessage({ role: 'user', content: 'Create a hello world app' }),
      makeMessage({
        role: 'tool',
        content: 'File written',
        toolName: 'Write',
        toolInput: '{"file_path":"/src/app.ts"}',
        toolStatus: 'completed',
      }),
      makeMessage({
        role: 'tool',
        content: 'File written',
        toolName: 'Write',
        toolInput: '{"file_path":"/src/index.ts"}',
        toolStatus: 'completed',
      }),
      makeMessage({
        role: 'assistant',
        content: 'Here is your app:\n```ts\nconsole.log("hello")\n```\nDone!',
      }),
    ],
    ...overrides,
  })

  useSessionStore.setState({ tabs: [tab], activeTabId: TAB_ID })
  return tab
}

describe('CompletionSummary', () => {
  beforeEach(() => {
    resetTestState()
  })

  it('renders when tab status is completed', () => {
    setupTab()
    renderWithProviders(<CompletionSummary tabId={TAB_ID} />)
    expect(screen.getByTestId('completion-summary')).toBeInTheDocument()
  })

  it('does not render when tab status is running', () => {
    setupTab({ status: 'running', lastResult: null })
    renderWithProviders(<CompletionSummary tabId={TAB_ID} />)
    expect(screen.queryByTestId('completion-summary')).not.toBeInTheDocument()
  })

  it('does not render when lastResult is null', () => {
    setupTab({ lastResult: null })
    renderWithProviders(<CompletionSummary tabId={TAB_ID} />)
    expect(screen.queryByTestId('completion-summary')).not.toBeInTheDocument()
  })

  it('shows summary line with duration, cost, tool calls, and files', () => {
    setupTab()
    renderWithProviders(<CompletionSummary tabId={TAB_ID} />)
    const line = screen.getByTestId('completion-summary-line')
    expect(line.textContent).toContain('13s')
    expect(line.textContent).toContain('$0.042')
    expect(line.textContent).toContain('2 tool calls')
    expect(line.textContent).toContain('2 files')
  })

  it('expands to show details when clicked', () => {
    setupTab()
    renderWithProviders(<CompletionSummary tabId={TAB_ID} />)

    expect(screen.queryByTestId('completion-summary-details')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('completion-summary-toggle'))

    expect(screen.getByTestId('completion-summary-details')).toBeInTheDocument()
  })

  it('shows token breakdown in expanded view', () => {
    setupTab()
    renderWithProviders(<CompletionSummary tabId={TAB_ID} />)

    fireEvent.click(screen.getByTestId('completion-summary-toggle'))

    const tokens = screen.getByTestId('completion-summary-tokens')
    expect(tokens.textContent).toContain('5.0k in')
    expect(tokens.textContent).toContain('1.2k out')
    expect(tokens.textContent).toContain('3.0k cache')
  })

  it('shows files modified list in expanded view', () => {
    setupTab()
    renderWithProviders(<CompletionSummary tabId={TAB_ID} />)

    fireEvent.click(screen.getByTestId('completion-summary-toggle'))

    const files = screen.getByTestId('completion-summary-files')
    expect(files.textContent).toContain('src/app.ts')
    expect(files.textContent).toContain('src/index.ts')
  })

  it('shows copy all code button when code blocks exist', () => {
    setupTab()
    renderWithProviders(<CompletionSummary tabId={TAB_ID} />)

    fireEvent.click(screen.getByTestId('completion-summary-toggle'))

    expect(screen.getByTestId('completion-copy-code')).toBeInTheDocument()
  })

  it('shows copy response button when assistant text exists', () => {
    setupTab()
    renderWithProviders(<CompletionSummary tabId={TAB_ID} />)

    fireEvent.click(screen.getByTestId('completion-summary-toggle'))

    expect(screen.getByTestId('completion-copy-response')).toBeInTheDocument()
  })

  it('does not show copy code button when no code blocks', () => {
    setupTab({
      messages: [
        makeMessage({ role: 'user', content: 'hi' }),
        makeMessage({ role: 'assistant', content: 'Hello, no code here.' }),
      ],
    })
    renderWithProviders(<CompletionSummary tabId={TAB_ID} />)

    fireEvent.click(screen.getByTestId('completion-summary-toggle'))

    expect(screen.queryByTestId('completion-copy-code')).not.toBeInTheDocument()
  })

  it('copies code blocks to clipboard', async () => {
    setupTab()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    renderWithProviders(<CompletionSummary tabId={TAB_ID} />)

    fireEvent.click(screen.getByTestId('completion-summary-toggle'))
    fireEvent.click(screen.getByTestId('completion-copy-code'))

    expect(writeText).toHaveBeenCalledWith('console.log("hello")')
  })

  it('copies response text to clipboard', async () => {
    setupTab()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    renderWithProviders(<CompletionSummary tabId={TAB_ID} />)

    fireEvent.click(screen.getByTestId('completion-summary-toggle'))
    fireEvent.click(screen.getByTestId('completion-copy-response'))

    expect(writeText).toHaveBeenCalledWith(
      'Here is your app:\n```ts\nconsole.log("hello")\n```\nDone!',
    )
  })

  it('handles singular tool call text', () => {
    setupTab({
      messages: [
        makeMessage({ role: 'user', content: 'hi' }),
        makeMessage({ role: 'tool', content: 'done', toolName: 'Read', toolInput: '{"file_path":"/src/a.ts"}' }),
        makeMessage({ role: 'assistant', content: 'Done.' }),
      ],
    })
    renderWithProviders(<CompletionSummary tabId={TAB_ID} />)
    const line = screen.getByTestId('completion-summary-line')
    expect(line.textContent).toContain('1 tool call')
    // Must not say "1 tool calls"
    expect(line.textContent).not.toContain('1 tool calls')
  })

  it('collapses when toggle is clicked again', () => {
    setupTab()
    renderWithProviders(<CompletionSummary tabId={TAB_ID} />)

    // Expand
    fireEvent.click(screen.getByTestId('completion-summary-toggle'))
    expect(screen.getByTestId('completion-summary-details')).toBeInTheDocument()

    // Collapse
    fireEvent.click(screen.getByTestId('completion-summary-toggle'))
    // AnimatePresence will remove it after exit animation, but the exit variant is triggered
    // In test env framer-motion exits synchronously
    expect(screen.queryByTestId('completion-summary-details')).not.toBeInTheDocument()
  })
})
