// @vitest-environment jsdom

import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionDigestSettings } from '../../src/renderer/components/SessionDigestSettings'
import { useSessionDigestStore } from '../../src/renderer/stores/sessionDigestStore'
import { renderWithProviders, resetTestState, installCluiMock } from './testUtils'

describe('SessionDigestSettings', () => {
  beforeEach(() => {
    resetTestState()
    useSessionDigestStore.setState(useSessionDigestStore.getInitialState(), true)
    installCluiMock({
      sessionDigestGetSetting: vi.fn().mockResolvedValue(false),
      sessionDigestSetSetting: vi.fn().mockResolvedValue(true),
      sessionDigestGetStats: vi.fn().mockResolvedValue({
        totalDigests: 5,
        totalCostUsd: 0.12,
        monthlyDigests: 2,
        monthlyCostUsd: 0.04,
      }),
    } as any)
  })

  it('renders the toggle', async () => {
    renderWithProviders(<SessionDigestSettings />)

    expect(screen.getByText('Session digests')).toBeInTheDocument()
    expect(screen.getByLabelText('Toggle cross-session context digests')).toBeInTheDocument()
  })

  it('shows info text about cost', () => {
    renderWithProviders(<SessionDigestSettings />)

    expect(screen.getByText(/Haiku 4\.5/)).toBeInTheDocument()
    expect(screen.getByText(/\$0\.01-0\.03\/session/)).toBeInTheDocument()
  })

  it('displays stats when enabled', async () => {
    useSessionDigestStore.setState({
      enabled: true,
      stats: {
        totalDigests: 5,
        totalCostUsd: 0.12,
        monthlyDigests: 2,
        monthlyCostUsd: 0.04,
      },
    })

    renderWithProviders(<SessionDigestSettings />)

    expect(screen.getByText(/5 digests total/)).toBeInTheDocument()
    expect(screen.getByText(/\$0\.12/)).toBeInTheDocument()
    expect(screen.getByText(/2 this month/)).toBeInTheDocument()
  })

  it('formats costs below $0.01 as <$0.01', async () => {
    useSessionDigestStore.setState({
      enabled: true,
      stats: {
        totalDigests: 1,
        totalCostUsd: 0.005,
        monthlyDigests: 1,
        monthlyCostUsd: 0.005,
      },
    })

    renderWithProviders(<SessionDigestSettings />)

    const costTexts = screen.getAllByText(/<\$0\.01/)
    expect(costTexts.length).toBeGreaterThanOrEqual(1)
  })
})
