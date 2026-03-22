// @vitest-environment jsdom

import React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TabStrip } from '../../../src/renderer/components/TabStrip'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { useTabGroupStore } from '../../../src/renderer/stores/tabGroupStore'
import { renderWithProviders, resetTestState, makeTab, makeMessage } from '../testUtils'

describe('TabStrip', () => {
  beforeEach(() => {
    resetTestState()
  })

  it('renders the current tabs and marks the active one', () => {
    useSessionStore.setState({
      tabs: [
        makeTab({ id: 'tab-1', title: 'Alpha' }),
        makeTab({ id: 'tab-2', title: 'Beta' }),
      ],
      tabOrder: ['tab-1', 'tab-2'],
      activeTabId: 'tab-1',
    })

    renderWithProviders(<TabStrip />)

    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Alpha')
    expect(screen.getByRole('tab', { selected: false })).toHaveTextContent('Beta')
  })

  it('selects another tab when it is clicked', () => {
    const selectTab = vi.fn()
    useSessionStore.setState({
      selectTab,
      tabs: [
        makeTab({ id: 'tab-1', title: 'Alpha' }),
        makeTab({ id: 'tab-2', title: 'Beta' }),
      ],
      tabOrder: ['tab-1', 'tab-2'],
      activeTabId: 'tab-1',
    })

    renderWithProviders(<TabStrip />)

    fireEvent.click(screen.getByRole('tab', { selected: false }))

    expect(selectTab).toHaveBeenCalledWith('tab-2')
  })

  it('creates a new tab from the plus button', () => {
    const createTab = vi.fn()
    useSessionStore.setState({
      createTab,
      tabs: [makeTab({ id: 'tab-1', title: 'Solo' })],
      tabOrder: ['tab-1'],
      activeTabId: 'tab-1',
    })

    renderWithProviders(<TabStrip />)

    fireEvent.click(screen.getByTestId('tab-new-button'))

    expect(createTab).toHaveBeenCalledTimes(1)
  })

  it('renders tab groups before grouped tabs', () => {
    useTabGroupStore.setState({
      groups: [{ id: 'group-1', name: 'Backend', collapsed: false, order: 0, color: 'blue' }],
    })
    useSessionStore.setState({
      tabs: [
        makeTab({ id: 'tab-1', title: 'Alpha', groupId: 'group-1' }),
        makeTab({ id: 'tab-2', title: 'Beta' }),
      ],
      tabOrder: ['tab-1', 'tab-2'],
      activeTabId: 'tab-1',
    })

    renderWithProviders(<TabStrip />)

    expect(screen.getByText('Backend')).toBeInTheDocument()
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Alpha')
  })

  describe('Session Continuity Dot (freshness indicator)', () => {
    it('shows green (active) dot when lastActivityAt is recent and tab has messages', () => {
      const recentTime = Date.now() - 5 * 60 * 1000 // 5 minutes ago
      useSessionStore.setState({
        tabs: [
          makeTab({
            id: 'tab-1',
            title: 'Active',
            status: 'idle',
            lastActivityAt: recentTime,
            messages: [makeMessage({ role: 'user', content: 'hello' })],
          }),
        ],
        tabOrder: ['tab-1'],
        activeTabId: 'tab-1',
      })

      renderWithProviders(<TabStrip />)

      const dot = screen.getByTestId('status-dot')
      // Green freshness color should be applied (not the idle gray)
      expect(dot.style.background).not.toBe('')
      expect(dot.getAttribute('title')).toMatch(/Active/)
    })

    it('shows amber (stale) dot when lastActivityAt is over 2 hours ago', () => {
      const staleTime = Date.now() - 3 * 60 * 60 * 1000 // 3 hours ago
      useSessionStore.setState({
        tabs: [
          makeTab({
            id: 'tab-1',
            title: 'Stale',
            status: 'idle',
            lastActivityAt: staleTime,
            messages: [makeMessage({ role: 'user', content: 'hello' })],
          }),
        ],
        tabOrder: ['tab-1'],
        activeTabId: 'tab-1',
      })

      renderWithProviders(<TabStrip />)

      const dot = screen.getByTestId('status-dot')
      expect(dot.getAttribute('title')).toMatch(/Stale/)
    })

    it('shows gray (new) dot for new session with no messages', () => {
      useSessionStore.setState({
        tabs: [
          makeTab({
            id: 'tab-1',
            title: 'New',
            status: 'idle',
            lastActivityAt: 0,
            messages: [],
          }),
        ],
        tabOrder: ['tab-1'],
        activeTabId: 'tab-1',
      })

      renderWithProviders(<TabStrip />)

      const dot = screen.getByTestId('status-dot')
      expect(dot.getAttribute('title')).toBe('New session')
    })

    it('does not show freshness tooltip when tab is running', () => {
      useSessionStore.setState({
        tabs: [
          makeTab({
            id: 'tab-1',
            title: 'Running',
            status: 'running',
            lastActivityAt: Date.now(),
            messages: [makeMessage({ role: 'user', content: 'hello' })],
          }),
        ],
        tabOrder: ['tab-1'],
        activeTabId: 'tab-1',
      })

      renderWithProviders(<TabStrip />)

      const dot = screen.getByTestId('status-dot')
      // Running tabs should not show a freshness tooltip
      expect(dot.getAttribute('title')).toBe('')
    })

    it('shows token count in tooltip when available', () => {
      const recentTime = Date.now() - 10 * 60 * 1000 // 10 minutes ago
      useSessionStore.setState({
        tabs: [
          makeTab({
            id: 'tab-1',
            title: 'WithTokens',
            status: 'idle',
            lastActivityAt: recentTime,
            messages: [makeMessage({ role: 'user', content: 'hello' })],
            lastResult: {
              totalCostUsd: 0.01,
              durationMs: 5000,
              numTurns: 1,
              usage: { input_tokens: 500, output_tokens: 200 },
              sessionId: 'sess-1',
            },
          }),
        ],
        tabOrder: ['tab-1'],
        activeTabId: 'tab-1',
      })

      renderWithProviders(<TabStrip />)

      const dot = screen.getByTestId('status-dot')
      expect(dot.getAttribute('title')).toMatch(/700 tokens/)
    })
  })
})
