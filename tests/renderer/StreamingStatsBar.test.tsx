// @vitest-environment jsdom

import React from 'react'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { StreamingStatsBar } from '../../src/renderer/components/StreamingStatsBar'
import { useSessionStore } from '../../src/renderer/stores/sessionStore'
import { makeTab, makeMessage, renderWithProviders, resetTestState } from './testUtils'

describe('StreamingStatsBar', () => {
  beforeEach(() => {
    resetTestState()
  })

  it('renders nothing when tab is idle', () => {
    const tab = makeTab({
      id: 'tab-1',
      status: 'idle',
      messages: [makeMessage({ role: 'assistant', content: 'Hello world' })],
    })
    useSessionStore.setState({ tabs: [tab], activeTabId: 'tab-1' })

    const { container } = renderWithProviders(
      <StreamingStatsBar tabId="tab-1" elapsedSeconds={5} />,
    )
    expect(container.querySelector('[data-testid="streaming-stats-bar"]')).toBeNull()
  })

  it('renders nothing when streaming but no assistant content', () => {
    const tab = makeTab({
      id: 'tab-1',
      status: 'running',
      messages: [makeMessage({ role: 'user', content: 'Hi' })],
    })
    useSessionStore.setState({ tabs: [tab], activeTabId: 'tab-1' })

    const { container } = renderWithProviders(
      <StreamingStatsBar tabId="tab-1" elapsedSeconds={1} />,
    )
    expect(container.querySelector('[data-testid="streaming-stats-bar"]')).toBeNull()
  })

  it('renders when streaming with assistant content', () => {
    const tab = makeTab({
      id: 'tab-1',
      status: 'running',
      messages: [
        makeMessage({ role: 'user', content: 'Hello' }),
        makeMessage({ role: 'assistant', content: 'Here is my response with several words' }),
      ],
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 500,
        totalTokens: 600,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        lastUpdated: Date.now(),
      },
      sessionModel: 'claude-opus-4-6',
    })
    useSessionStore.setState({ tabs: [tab], activeTabId: 'tab-1' })

    renderWithProviders(
      <StreamingStatsBar tabId="tab-1" elapsedSeconds={3.5} />,
    )

    const bar = screen.getByTestId('streaming-stats-bar')
    expect(bar).toBeInTheDocument()
    // Word count
    expect(bar.textContent).toContain('7 words')
    // Token count
    expect(bar.textContent).toContain('500 tokens')
    // Elapsed time
    expect(bar.textContent).toContain('3.5s')
  })

  it('hides cost when outputTokens is 0', () => {
    const tab = makeTab({
      id: 'tab-1',
      status: 'running',
      messages: [
        makeMessage({ role: 'assistant', content: 'Hello world' }),
      ],
      tokenUsage: null,
    })
    useSessionStore.setState({ tabs: [tab], activeTabId: 'tab-1' })

    renderWithProviders(
      <StreamingStatsBar tabId="tab-1" elapsedSeconds={1} />,
    )

    const bar = screen.getByTestId('streaming-stats-bar')
    expect(bar.textContent).not.toContain('$')
  })

  it('shows estimated cost when tokens are present', () => {
    const tab = makeTab({
      id: 'tab-1',
      status: 'running',
      messages: [
        makeMessage({ role: 'assistant', content: 'Hello' }),
      ],
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 10_000,
        totalTokens: 10_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        lastUpdated: Date.now(),
      },
      sessionModel: 'claude-opus-4-6',
    })
    useSessionStore.setState({ tabs: [tab], activeTabId: 'tab-1' })

    renderWithProviders(
      <StreamingStatsBar tabId="tab-1" elapsedSeconds={5} />,
    )

    const bar = screen.getByTestId('streaming-stats-bar')
    // 10k tokens * $15/MTok = $0.15
    expect(bar.textContent).toContain('~$0.150')
  })

  it('uses last assistant message for word count', () => {
    const tab = makeTab({
      id: 'tab-1',
      status: 'running',
      messages: [
        makeMessage({ role: 'assistant', content: 'old message' }),
        makeMessage({ role: 'user', content: 'follow up' }),
        makeMessage({ role: 'assistant', content: 'one two three' }),
      ],
    })
    useSessionStore.setState({ tabs: [tab], activeTabId: 'tab-1' })

    renderWithProviders(
      <StreamingStatsBar tabId="tab-1" elapsedSeconds={2} />,
    )

    const bar = screen.getByTestId('streaming-stats-bar')
    expect(bar.textContent).toContain('3 words')
  })
})
