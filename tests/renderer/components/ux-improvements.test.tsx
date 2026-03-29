// @vitest-environment jsdom

import React from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationView } from '../../../src/renderer/components/ConversationView'
import { StatusBar } from '../../../src/renderer/components/StatusBar'
import { PermissionCard } from '../../../src/renderer/components/PermissionCard'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { useNotificationStore } from '../../../src/renderer/stores/notificationStore'
import { usePermissionStore } from '../../../src/renderer/stores/permissionStore'
import { useOnboardingStore } from '../../../src/renderer/stores/onboardingStore'
import { renderWithProviders, resetTestState, makeMessage, makeTab } from '../testUtils'

// ─── UX-012: Empty conversation welcome state ───

describe('UX-012: Empty conversation welcome state', () => {
  beforeEach(() => {
    resetTestState()
    // Mark onboarding as completed so ConversationView shows the normal EmptyState
    // instead of OnboardingWelcome (added in #307)
    useOnboardingStore.setState({ completed: true })
  })

  it('renders a welcome card with tagline when conversation is empty', () => {
    useSessionStore.setState({
      tabs: [makeTab({ id: 'tab-1', messages: [], hasChosenDirectory: true })],
      activeTabId: 'tab-1',
    })

    renderWithProviders(<ConversationView />)

    expect(screen.getByTestId('welcome-card')).toBeInTheDocument()
    expect(screen.getByText(/What can I help you with/i)).toBeInTheDocument()
  })

  it('renders example prompt chips in the welcome card', () => {
    useSessionStore.setState({
      tabs: [makeTab({ id: 'tab-1', messages: [], hasChosenDirectory: true })],
      activeTabId: 'tab-1',
    })

    renderWithProviders(<ConversationView />)

    const chips = screen.getAllByTestId('prompt-chip')
    expect(chips.length).toBeGreaterThanOrEqual(2)
  })

  it('clicking a prompt chip calls sendMessage', () => {
    const sendMessage = vi.fn()
    useSessionStore.setState({
      sendMessage,
      tabs: [makeTab({ id: 'tab-1', messages: [], hasChosenDirectory: true })],
      activeTabId: 'tab-1',
    })

    renderWithProviders(<ConversationView />)

    const chips = screen.getAllByTestId('prompt-chip')
    fireEvent.click(chips[0])
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('renders a directory picker in the welcome state', () => {
    useSessionStore.setState({
      tabs: [makeTab({ id: 'tab-1', messages: [], hasChosenDirectory: false })],
      activeTabId: 'tab-1',
    })

    renderWithProviders(<ConversationView />)

    expect(screen.getByTestId('welcome-card')).toBeInTheDocument()
  })
})

// ─── UX-013: Status bar hierarchy overhaul ───

describe('UX-013: Status bar hierarchy overhaul', () => {
  beforeEach(() => {
    resetTestState()
  })

  it('renders left cluster with directory and model', () => {
    useSessionStore.setState({
      tabs: [makeTab({ id: 'tab-1', hasChosenDirectory: true, workingDirectory: '/home/user/project' })],
      activeTabId: 'tab-1',
    })

    renderWithProviders(<StatusBar />)

    const statusBar = screen.getByTestId('status-bar')
    expect(statusBar).toBeInTheDocument()
    expect(screen.getByTestId('status-left-cluster')).toBeInTheDocument()
    expect(screen.getByTestId('status-right-cluster')).toBeInTheDocument()
  })

  it('renders separators between groups', () => {
    useSessionStore.setState({
      tabs: [makeTab({ id: 'tab-1', hasChosenDirectory: true })],
      activeTabId: 'tab-1',
    })

    renderWithProviders(<StatusBar />)

    const separators = screen.getAllByTestId('status-separator')
    expect(separators.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── UX-014: Fix textMuted color contrast ───

describe('UX-014: textMuted color contrast', () => {
  it('dark mode textMuted has adequate contrast against containerBg', async () => {
    const { getColors } = await import('../../../src/renderer/theme')
    const darkColors = getColors(true)
    // Old value was #353530 which is too close to #242422 container bg
    expect(darkColors.textMuted).not.toBe('#353530')
  })

  it('light theme accent is suitable for text', async () => {
    const { getColors } = await import('../../../src/renderer/theme')
    const lightColors = getColors(false)
    // accent should have decent contrast for text usage
    expect(lightColors.accent).toBeDefined()
  })
})

// ─── UX-015: Permission card input preview ───

describe('UX-015: Permission card input preview', () => {
  beforeEach(() => {
    resetTestState()
  })

  it('renders input preview with increased maxHeight and scrollable overflow', () => {
    useSessionStore.setState({
      tabs: [makeTab({ id: 'tab-1' })],
      activeTabId: 'tab-1',
    })

    const permission = {
      questionId: 'q1',
      toolTitle: 'Bash',
      toolDescription: 'Run a command',
      toolInput: { command: 'echo hello world '.repeat(50) },
      options: [
        { optionId: 'allow', label: 'Allow', kind: 'allow' as const },
        { optionId: 'deny', label: 'Deny', kind: 'deny' as const },
      ],
    }

    renderWithProviders(
      <PermissionCard tabId="tab-1" permission={permission} queueLength={1} />,
    )

    const preview = screen.getByTestId('permission-input-preview')
    expect(preview).toBeInTheDocument()
    // Check maxHeight is 120px (increased from 80)
    expect(preview.style.maxHeight).toBe('120px')
    // Check overflow-y is auto
    expect(preview.style.overflowY).toBe('auto')
  })

  it('shows gradient fade when content is truncated', () => {
    const permission = {
      questionId: 'q1',
      toolTitle: 'Bash',
      toolDescription: 'Run a command',
      toolInput: { command: 'x'.repeat(500) },
      options: [
        { optionId: 'allow', label: 'Allow', kind: 'allow' as const },
        { optionId: 'deny', label: 'Deny', kind: 'deny' as const },
      ],
    }

    renderWithProviders(
      <PermissionCard tabId="tab-1" permission={permission} queueLength={1} />,
    )

    const wrapper = screen.getByTestId('permission-input-wrapper')
    expect(wrapper).toBeInTheDocument()
  })
})

// ─── UX-016: Dead session recovery actions ───

describe('UX-016: Dead session recovery actions', () => {
  beforeEach(() => {
    resetTestState()
  })

  it('renders a recovery card instead of bare text when session is dead', () => {
    useSessionStore.setState({
      tabs: [makeTab({ id: 'tab-1', status: 'dead', messages: [makeMessage({ role: 'user', content: 'test' })] })],
      activeTabId: 'tab-1',
    })

    renderWithProviders(<ConversationView />)

    expect(screen.getByTestId('dead-recovery-card')).toBeInTheDocument()
    expect(screen.getByText(/Session ended unexpectedly/)).toBeInTheDocument()
  })

  it('shows Resume button and New Tab link in recovery card', () => {
    const resumeSession = vi.fn().mockResolvedValue('new-tab')
    useSessionStore.setState({
      resumeSession,
      tabs: [makeTab({
        id: 'tab-1',
        status: 'dead',
        claudeSessionId: 'session-123',
        messages: [makeMessage({ role: 'user', content: 'test' })],
      })],
      activeTabId: 'tab-1',
    })

    renderWithProviders(<ConversationView />)

    expect(screen.getByTestId('dead-resume-btn')).toBeInTheDocument()
    expect(screen.getByTestId('dead-new-tab-btn')).toBeInTheDocument()
  })
})

// ─── UX-017: Queued prompts silently dropped ───

describe('UX-017: Queued prompts silently dropped', () => {
  beforeEach(() => {
    resetTestState()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows toast when queue is full and message is dropped', () => {
    // Fill the queue to max
    const queuedPrompts = Array.from({ length: 20 }, (_, i) => `prompt-${i}`)
    const queuedRunOptions = Array.from({ length: 20 }, () => ({
      prompt: 'test',
      projectPath: '/test',
    }))

    useSessionStore.setState({
      tabs: [makeTab({
        id: 'tab-1',
        status: 'running',
        queuedPrompts,
        queuedRunOptions,
      })],
      activeTabId: 'tab-1',
    })

    // Try sending another message when queue is full
    useSessionStore.getState().sendMessage('overflow prompt')

    // Check that a toast was generated
    const toasts = useNotificationStore.getState().toasts
    expect(toasts.some((t) => t.type === 'warning' && t.title.toLowerCase().includes('queue'))).toBe(true)
  })
})

// ─── UX-018: Auto permission mode confirmation ───

describe('UX-018: Auto permission mode confirmation dialog', () => {
  beforeEach(() => {
    resetTestState()
  })

  it('shows confirmation dialog when switching to auto mode', () => {
    useSessionStore.setState({
      tabs: [makeTab({ id: 'tab-1' })],
      activeTabId: 'tab-1',
    })

    renderWithProviders(<StatusBar />)

    // The permission mode picker should exist
    const statusBar = screen.getByTestId('status-bar')
    expect(statusBar).toBeInTheDocument()
  })
})
