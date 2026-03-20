// @vitest-environment jsdom

import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextPanel } from '../../../src/renderer/components/ContextPanel'
import { useContextStore } from '../../../src/renderer/stores/contextStore'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { useNotificationStore } from '../../../src/renderer/stores/notificationStore'
import { renderWithProviders, resetTestState, makeTab } from '../testUtils'
import type { ContextMemory, ContextSessionSummary, MemorySearchResult } from '../../../src/shared/context-types'

function makeMemory(overrides: Partial<MemorySearchResult> = {}): MemorySearchResult {
  return {
    id: overrides.id || crypto.randomUUID(),
    memoryType: 'session_outcome',
    scope: 'project',
    title: 'Test memory',
    body: 'Test body text',
    importanceScore: 0.7,
    confidenceScore: 1.0,
    isPinned: false,
    accessCount: 3,
    createdAt: '2026-03-15T10:00:00Z',
    updatedAt: '2026-03-15T10:00:00Z',
    ...overrides,
  }
}

function makeSession(overrides: Partial<ContextSessionSummary> = {}): ContextSessionSummary {
  return {
    id: overrides.id || crypto.randomUUID(),
    title: 'Test session',
    goal: null,
    status: 'completed',
    startedAt: '2026-03-15T10:00:00Z',
    endedAt: '2026-03-15T10:05:00Z',
    filesTouchedCount: 2,
    toolsUsed: ['Read', 'Edit'],
    costUsd: 0.01,
    durationMs: 5000,
    summary: 'Did some work',
    ...overrides,
  }
}

function setupContextMocks() {
  const mock = {
    contextSearchMemories: vi.fn().mockResolvedValue([]),
    contextGetSessionHistory: vi.fn().mockResolvedValue([]),
    contextGetSessionDetail: vi.fn().mockResolvedValue(null),
    contextGetProjectStats: vi.fn().mockResolvedValue(null),
    contextPinMemory: vi.fn().mockResolvedValue(undefined),
    contextUnpinMemory: vi.fn().mockResolvedValue(undefined),
    contextDeleteMemory: vi.fn().mockResolvedValue(undefined),
    contextGetFilesTouched: vi.fn().mockResolvedValue([]),
    contextGetMemoryPacketPreview: vi.fn().mockResolvedValue(null),
    onContextMemoryCreated: vi.fn(() => () => {}),
    onContextSessionRecorded: vi.fn(() => () => {}),
  }

  // Merge into existing window.clui
  Object.assign(window.clui, mock)
  return mock
}

describe('ContextPanel', () => {
  beforeEach(() => {
    resetTestState()
    setupContextMocks()

    // Set up a tab with a working directory
    const tab = makeTab({ id: 'tab-1', workingDirectory: 'C:/project' })
    useSessionStore.setState({ tabs: [tab], activeTabId: 'tab-1' })
  })

  it('does not render when panel is closed', () => {
    useContextStore.setState({ panelOpen: false })
    renderWithProviders(<ContextPanel />)
    expect(screen.queryByTestId('context-panel')).not.toBeInTheDocument()
  })

  it('renders when panel is open', () => {
    useContextStore.setState({ panelOpen: true })
    renderWithProviders(<ContextPanel />)
    expect(screen.getByTestId('context-panel')).toBeInTheDocument()
    expect(screen.getByText('Context Database')).toBeInTheDocument()
  })

  it('shows section tabs', () => {
    useContextStore.setState({ panelOpen: true })
    renderWithProviders(<ContextPanel />)
    expect(screen.getByText('Memories')).toBeInTheDocument()
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('Preview')).toBeInTheDocument()
  })

  it('closes panel when close button is clicked', () => {
    useContextStore.setState({ panelOpen: true })
    renderWithProviders(<ContextPanel />)

    fireEvent.click(screen.getByLabelText('Close context panel'))

    expect(useContextStore.getState().panelOpen).toBe(false)
  })

  it('switches section when tab is clicked', () => {
    useContextStore.setState({ panelOpen: true })
    renderWithProviders(<ContextPanel />)

    fireEvent.click(screen.getByText('Sessions'))

    expect(useContextStore.getState().activeSection).toBe('sessions')
  })

  it('shows "No memories found" when memories list is empty', () => {
    useContextStore.setState({ panelOpen: true, activeSection: 'memories', memories: [] })
    renderWithProviders(<ContextPanel />)

    expect(screen.getByText('No memories found')).toBeInTheDocument()
  })

  it('renders memory cards when memories exist', () => {
    const memories = [makeMemory({ title: 'Important fix' })]
    useContextStore.setState({ panelOpen: true, activeSection: 'memories', memories })
    renderWithProviders(<ContextPanel />)

    expect(screen.getByText('Important fix')).toBeInTheDocument()
    expect(screen.getByText('Test body text')).toBeInTheDocument()
  })

  it('renders session cards in sessions section', () => {
    const sessions = [makeSession({ title: 'Bug fix session' })]
    useContextStore.setState({ panelOpen: true, activeSection: 'sessions', sessionHistory: sessions })
    renderWithProviders(<ContextPanel />)

    expect(screen.getByText('Bug fix session')).toBeInTheDocument()
    expect(screen.getByText('completed')).toBeInTheDocument()
  })

  it('shows "No session history yet" when sessions empty', () => {
    useContextStore.setState({ panelOpen: true, activeSection: 'sessions', sessionHistory: [] })
    renderWithProviders(<ContextPanel />)

    expect(screen.getByText('No session history yet')).toBeInTheDocument()
  })

  it('shows "No file activity recorded" when files empty', () => {
    useContextStore.setState({ panelOpen: true, activeSection: 'files', filesTouched: [] })
    renderWithProviders(<ContextPanel />)

    expect(screen.getByText('No file activity recorded')).toBeInTheDocument()
  })

  it('renders file table when files exist', () => {
    const files = [
      { path: 'src/index.ts', totalTouches: 5, actions: ['read', 'write'], lastTouched: '2026-03-15T10:00:00Z', sessionCount: 2 },
    ]
    useContextStore.setState({ panelOpen: true, activeSection: 'files', filesTouched: files })
    renderWithProviders(<ContextPanel />)

    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('read')).toBeInTheDocument()
    expect(screen.getByText('write')).toBeInTheDocument()
  })

  it('shows project stats in header when available', () => {
    const stats = {
      projectId: 'p1',
      projectName: 'Test',
      sessionCount: 5,
      totalCostUsd: 0.5,
      uniqueFilesTouched: 10,
      memoryCount: 3,
      lastActiveAt: new Date().toISOString(),
    }
    useContextStore.setState({ panelOpen: true, projectStats: stats })
    renderWithProviders(<ContextPanel />)

    expect(screen.getByText('5 sessions, 3 memories, 10 files')).toBeInTheDocument()
  })

  it('shows importance badge on memory cards', () => {
    const memories = [makeMemory({ importanceScore: 0.9, title: 'Critical' })]
    useContextStore.setState({ panelOpen: true, activeSection: 'memories', memories })
    renderWithProviders(<ContextPanel />)

    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('renders pinned memory with pin icon styling', () => {
    const memories = [makeMemory({ isPinned: true, title: 'Pinned item' })]
    useContextStore.setState({ panelOpen: true, activeSection: 'memories', memories })
    renderWithProviders(<ContextPanel />)

    expect(screen.getByText('Pinned item')).toBeInTheDocument()
  })

  it('renders preview section with XML block', async () => {
    // Mock the IPC to return the preview data
    ;(window.clui.contextGetMemoryPacketPreview as ReturnType<typeof vi.fn>).mockResolvedValue(
      '<clui_context>test data</clui_context>',
    )
    useContextStore.setState({
      panelOpen: true,
      activeSection: 'preview',
    })
    renderWithProviders(<ContextPanel />)

    await waitFor(() => {
      expect(screen.getByText('<clui_context>test data</clui_context>')).toBeInTheDocument()
    })
  })

  it('shows empty message when no preview available', async () => {
    ;(window.clui.contextGetMemoryPacketPreview as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    useContextStore.setState({
      panelOpen: true,
      activeSection: 'preview',
    })
    renderWithProviders(<ContextPanel />)

    await waitFor(() => {
      expect(screen.getByText('No context data available for this project')).toBeInTheDocument()
    })
  })
})
