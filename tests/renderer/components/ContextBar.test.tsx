// @vitest-environment jsdom

import React from 'react'
import { screen } from '@testing-library/react'
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
})
