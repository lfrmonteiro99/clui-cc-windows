// @vitest-environment jsdom

import React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ContextBar } from '../../../src/renderer/components/ContextBar'
import { useTokenBudgetStore } from '../../../src/renderer/stores/tokenBudgetStore'
import { renderWithProviders, resetTestState } from '../testUtils'

describe('ContextBar', () => {
  beforeEach(() => {
    resetTestState()
    useTokenBudgetStore.setState({
      budgets: {},
      maxContextTokens: 200_000,
    })
  })

  it('renders nothing when there is no budget data for the tab', () => {
    const { container } = renderWithProviders(<ContextBar tabId="tab-1" />)
    expect(container.querySelector('[data-testid="context-bar"]')).toBeNull()
  })

  it('renders the bar when budget data exists', () => {
    useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 50_000 })

    renderWithProviders(<ContextBar tabId="tab-1" />)
    expect(screen.getByTestId('context-bar')).toBeInTheDocument()
  })

  it('shows utilization percentage', () => {
    useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 100_000 })

    renderWithProviders(<ContextBar tabId="tab-1" />)
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('renders category segments', () => {
    useTokenBudgetStore.getState().recordUsage('tab-1', {
      input_tokens: 10_000,
      output_tokens: 5_000,
    })

    renderWithProviders(<ContextBar tabId="tab-1" />)
    const segments = screen.getAllByTestId('context-bar-segment')
    expect(segments.length).toBe(2)
  })

  it('shows warning state at 70%+ utilization', () => {
    useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 150_000 })

    renderWithProviders(<ContextBar tabId="tab-1" />)
    expect(screen.getByTestId('context-bar')).toHaveAttribute('data-threshold', 'warning')
  })

  it('shows critical state at 85%+ utilization', () => {
    useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 180_000 })

    renderWithProviders(<ContextBar tabId="tab-1" />)
    expect(screen.getByTestId('context-bar')).toHaveAttribute('data-threshold', 'critical')
  })

  it('shows normal state below 70%', () => {
    useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 50_000 })

    renderWithProviders(<ContextBar tabId="tab-1" />)
    expect(screen.getByTestId('context-bar')).toHaveAttribute('data-threshold', 'normal')
  })

  it('displays headroom token count', () => {
    useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 50_000 })

    renderWithProviders(<ContextBar tabId="tab-1" />)
    // 200k - 50k = 150k headroom
    expect(screen.getByText(/150k remaining/i)).toBeInTheDocument()
  })

  it('shows "Summarize history" action at warning threshold', () => {
    useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 150_000 })

    renderWithProviders(<ContextBar tabId="tab-1" />)
    expect(screen.getByText(/summarize/i)).toBeInTheDocument()
  })

  it('shows "Start fresh" action at critical threshold', () => {
    useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 180_000 })

    renderWithProviders(<ContextBar tabId="tab-1" />)
    expect(screen.getByText(/start fresh/i)).toBeInTheDocument()
  })

  it('does not show actions at normal threshold', () => {
    useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 50_000 })

    renderWithProviders(<ContextBar tabId="tab-1" />)
    expect(screen.queryByText(/summarize/i)).toBeNull()
    expect(screen.queryByText(/start fresh/i)).toBeNull()
  })

  it('shows turn count', () => {
    useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 1000 })
    useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 2000 })

    renderWithProviders(<ContextBar tabId="tab-1" />)
    expect(screen.getByText(/2 turns/i)).toBeInTheDocument()
  })

  it('formats large token counts with k suffix', () => {
    useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 50_000 })

    renderWithProviders(<ContextBar tabId="tab-1" />)
    // Should show "50k" somewhere in the display
    expect(screen.getByText(/50k/)).toBeInTheDocument()
  })

  // ─── Legend ───

  describe('legend', () => {
    it('renders a legend toggle button', () => {
      useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 10_000 })

      renderWithProviders(<ContextBar tabId="tab-1" />)
      expect(screen.getByTestId('context-bar-legend-toggle')).toBeInTheDocument()
    })

    it('legend is hidden by default', () => {
      useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 10_000 })

      renderWithProviders(<ContextBar tabId="tab-1" />)
      expect(screen.queryByTestId('context-bar-legend')).toBeNull()
    })

    it('shows the legend when toggle is clicked', () => {
      useTokenBudgetStore.getState().recordUsage('tab-1', {
        input_tokens: 10_000,
        output_tokens: 5_000,
        cache_read_input_tokens: 2_000,
        cache_creation_input_tokens: 1_000,
      })

      renderWithProviders(<ContextBar tabId="tab-1" />)
      fireEvent.click(screen.getByTestId('context-bar-legend-toggle'))

      const legend = screen.getByTestId('context-bar-legend')
      expect(legend).toBeInTheDocument()
    })

    it('displays human-friendly descriptions for each category', () => {
      useTokenBudgetStore.getState().recordUsage('tab-1', {
        input_tokens: 10_000,
        output_tokens: 5_000,
        cache_read_input_tokens: 2_000,
        cache_creation_input_tokens: 1_000,
      })

      renderWithProviders(<ContextBar tabId="tab-1" />)
      fireEvent.click(screen.getByTestId('context-bar-legend-toggle'))

      // Each category should have a description explaining what it is
      expect(screen.getByText(/what you send/i)).toBeInTheDocument()
      expect(screen.getByText(/what Claude replies/i)).toBeInTheDocument()
      expect(screen.getByText(/reused from previous/i)).toBeInTheDocument()
      expect(screen.getByText(/new context being saved/i)).toBeInTheDocument()
    })

    it('shows token count per category in the legend', () => {
      useTokenBudgetStore.getState().recordUsage('tab-1', {
        input_tokens: 10_000,
        output_tokens: 5_000,
      })

      renderWithProviders(<ContextBar tabId="tab-1" />)
      fireEvent.click(screen.getByTestId('context-bar-legend-toggle'))

      const legend = screen.getByTestId('context-bar-legend')
      expect(legend.textContent).toContain('10k')
      expect(legend.textContent).toContain('5k')
    })

    it('only shows categories that have tokens', () => {
      useTokenBudgetStore.getState().recordUsage('tab-1', {
        input_tokens: 10_000,
        output_tokens: 5_000,
      })

      renderWithProviders(<ContextBar tabId="tab-1" />)
      fireEvent.click(screen.getByTestId('context-bar-legend-toggle'))

      expect(screen.queryByText(/reused from previous/i)).toBeNull()
      expect(screen.queryByText(/new context being saved/i)).toBeNull()
    })

    it('explains the overall bar meaning', () => {
      useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 10_000 })

      renderWithProviders(<ContextBar tabId="tab-1" />)
      fireEvent.click(screen.getByTestId('context-bar-legend-toggle'))

      expect(screen.getByText(/memory capacity/i)).toBeInTheDocument()
    })

    it('hides legend when toggle is clicked again', () => {
      useTokenBudgetStore.getState().recordUsage('tab-1', { input_tokens: 10_000 })

      renderWithProviders(<ContextBar tabId="tab-1" />)
      const toggle = screen.getByTestId('context-bar-legend-toggle')

      fireEvent.click(toggle)
      expect(screen.getByTestId('context-bar-legend')).toBeInTheDocument()

      fireEvent.click(toggle)
      expect(screen.queryByTestId('context-bar-legend')).toBeNull()
    })
  })
})
