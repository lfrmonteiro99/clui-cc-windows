// @vitest-environment jsdom

import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusBar } from '../../../src/renderer/components/StatusBar'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { useNotificationStore } from '../../../src/renderer/stores/notificationStore'
import { renderWithProviders, resetTestState, makeTab, installCluiMock } from '../testUtils'

describe('CTX-008: Context Status Indicator in StatusBar', () => {
  beforeEach(() => {
    resetTestState()
  })

  function setupTab() {
    const tab = makeTab({ id: 'tab-1', status: 'idle', hasChosenDirectory: true, workingDirectory: '/project' })
    useSessionStore.setState({ tabs: [tab], activeTabId: 'tab-1' })
    return tab
  }

  it('shows green dot when context is active with memories', async () => {
    setupTab()
    installCluiMock({
      getContextHealth: vi.fn().mockResolvedValue({
        available: true,
        memoryCount: 10,
        sessionCount: 5,
        degradedReason: null,
      }),
    } as any)

    renderWithProviders(<StatusBar />)

    await waitFor(() => {
      const indicator = screen.getByTestId('context-health-indicator')
      expect(indicator).toBeInTheDocument()
      expect(indicator.getAttribute('title')).toContain('10 memories')
    })
  })

  it('shows yellow dot when context is active but with few memories', async () => {
    setupTab()
    installCluiMock({
      getContextHealth: vi.fn().mockResolvedValue({
        available: true,
        memoryCount: 2,
        sessionCount: 1,
        degradedReason: null,
      }),
    } as any)

    renderWithProviders(<StatusBar />)

    await waitFor(() => {
      const indicator = screen.getByTestId('context-health-indicator')
      expect(indicator).toBeInTheDocument()
      expect(indicator.getAttribute('title')).toContain('2 memories')
    })
  })

  it('shows red dot when context is unavailable', async () => {
    setupTab()
    installCluiMock({
      getContextHealth: vi.fn().mockResolvedValue({
        available: false,
        memoryCount: 0,
        sessionCount: 0,
        degradedReason: 'sqlite_unavailable',
      }),
    } as any)

    renderWithProviders(<StatusBar />)

    await waitFor(() => {
      const indicator = screen.getByTestId('context-health-indicator')
      expect(indicator).toBeInTheDocument()
      expect(indicator.getAttribute('title')).toContain('unavailable')
    })
  })

  it('shows gray dot when no project is selected', async () => {
    const tab = makeTab({ id: 'tab-1', status: 'idle', hasChosenDirectory: false, workingDirectory: '' })
    useSessionStore.setState({ tabs: [tab], activeTabId: 'tab-1' })

    renderWithProviders(<StatusBar />)

    await waitFor(() => {
      const indicator = screen.getByTestId('context-health-indicator')
      expect(indicator).toBeInTheDocument()
      expect(indicator.getAttribute('title')).toContain('No project')
    })
  })
})

describe('CTX-008: Toast on degraded context', () => {
  beforeEach(() => {
    resetTestState()
  })

  it('shows warning toast when context is unavailable on startup check', async () => {
    const tab = makeTab({ id: 'tab-1', status: 'idle', hasChosenDirectory: true, workingDirectory: '/project' })
    useSessionStore.setState({ tabs: [tab], activeTabId: 'tab-1' })
    installCluiMock({
      getContextHealth: vi.fn().mockResolvedValue({
        available: false,
        memoryCount: 0,
        sessionCount: 0,
        degradedReason: 'sqlite_unavailable',
      }),
    } as any)

    renderWithProviders(<StatusBar />)

    await waitFor(() => {
      const toasts = useNotificationStore.getState().toasts
      const degradedToast = toasts.find((t) => t.title.toLowerCase().includes('context'))
      expect(degradedToast).toBeDefined()
      expect(degradedToast!.type).toBe('warning')
    })
  })

  it('does not show toast when context is healthy', async () => {
    const tab = makeTab({ id: 'tab-1', status: 'idle', hasChosenDirectory: true, workingDirectory: '/project' })
    useSessionStore.setState({ tabs: [tab], activeTabId: 'tab-1' })
    installCluiMock({
      getContextHealth: vi.fn().mockResolvedValue({
        available: true,
        memoryCount: 10,
        sessionCount: 5,
        degradedReason: null,
      }),
    } as any)

    renderWithProviders(<StatusBar />)

    // Wait a bit and verify no degraded toast was shown
    await new Promise((r) => setTimeout(r, 50))
    const toasts = useNotificationStore.getState().toasts
    const degradedToast = toasts.find((t) => t.title.toLowerCase().includes('context'))
    expect(degradedToast).toBeUndefined()
  })
})
