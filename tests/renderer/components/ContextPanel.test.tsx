// @vitest-environment jsdom

import React from 'react'
import { act, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { ContextPanel } from '../../../src/renderer/components/ContextPanel'
import { useContextStore } from '../../../src/renderer/stores/contextStore'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { renderWithProviders, resetTestState, makeTab } from '../testUtils'
import type { ContextSessionSummary, MemorySearchResult } from '../../../src/shared/context-types'

// ─── Factories ───

function makeMemory(overrides: Partial<MemorySearchResult> = {}): MemorySearchResult {
  return {
    id: overrides.id ?? crypto.randomUUID(),
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
    id: overrides.id ?? crypto.randomUUID(),
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

// ─── IPC mock layer ───

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

  Object.assign(window.clui, mock)
  return mock
}

// ─── Helpers ───

async function flushAsync() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

/** Use empty workingDirectory to prevent the load-on-open useEffect from firing. */
function setTabWithoutProject() {
  useSessionStore.setState({
    tabs: [makeTab({ id: 'tab-1', workingDirectory: '' })],
    activeTabId: 'tab-1',
  })
}

function setTabWithProject() {
  useSessionStore.setState({
    tabs: [makeTab({ id: 'tab-1', workingDirectory: 'C:/project' })],
    activeTabId: 'tab-1',
  })
}

describe('ContextPanel', () => {
  beforeEach(() => {
    resetTestState()
    useContextStore.setState(useContextStore.getInitialState(), true)
    setupContextMocks()
    setTabWithoutProject()
  })

  afterEach(() => {
    // Close panel before cleanup to prevent floating async effects
    useContextStore.setState({ panelOpen: false })
    cleanup()
  })

  // ─── Visibility & structure ───

  it('does not render when panel is closed', () => {
    useContextStore.setState({ panelOpen: false })
    renderWithProviders(<ContextPanel />)
    expect(screen.queryByTestId('context-panel')).not.toBeInTheDocument()
  })

  it('renders panel with header and all section tabs when open', async () => {
    useContextStore.setState({ panelOpen: true })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    expect(screen.getByTestId('context-panel')).toBeInTheDocument()
    expect(screen.getByText('Context Database')).toBeInTheDocument()
    expect(screen.getByText('Memories')).toBeInTheDocument()
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('Preview')).toBeInTheDocument()
  })

  it('closes panel when close button is clicked', async () => {
    useContextStore.setState({ panelOpen: true })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Close context panel'))
    })

    expect(useContextStore.getState().panelOpen).toBe(false)
  })

  it('switches active section when a tab is clicked', async () => {
    useContextStore.setState({ panelOpen: true })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    await act(async () => {
      fireEvent.click(screen.getByText('Sessions'))
    })

    expect(useContextStore.getState().activeSection).toBe('sessions')
  })

  // ─── Memories section ───

  it('shows empty state when no memories exist', async () => {
    setTabWithoutProject()
    useContextStore.setState({ panelOpen: true, activeSection: 'memories', memories: [] })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    expect(screen.getByText('No memories found')).toBeInTheDocument()
  })

  it('renders memory cards with title, body, and importance badge', async () => {
    setTabWithoutProject()
    const memories = [
      makeMemory({ id: 'a', title: 'Critical fix', importanceScore: 0.9 }),
      makeMemory({ id: 'b', title: 'Minor note', importanceScore: 0.2, body: 'Low priority' }),
    ]
    useContextStore.setState({ panelOpen: true, activeSection: 'memories', memories })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    expect(screen.getByText('Critical fix')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('Minor note')).toBeInTheDocument()
    expect(screen.getByText('Low')).toBeInTheDocument()
  })

  it('shows Medium importance badge for scores between 0.4 and 0.7', async () => {
    setTabWithoutProject()
    const memories = [makeMemory({ importanceScore: 0.5, title: 'Moderate' })]
    useContextStore.setState({ panelOpen: true, activeSection: 'memories', memories })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    expect(screen.getByText('Medium')).toBeInTheDocument()
  })

  it('renders pinned memory with unpin button and unpinned with pin button', async () => {
    setTabWithoutProject()
    const memories = [
      makeMemory({ id: 'pinned', isPinned: true, title: 'Pinned item' }),
      makeMemory({ id: 'unpinned', isPinned: false, title: 'Regular item' }),
    ]
    useContextStore.setState({ panelOpen: true, activeSection: 'memories', memories })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    expect(screen.getByText('Pinned item')).toBeInTheDocument()
    expect(screen.getByTitle('Unpin memory')).toBeInTheDocument()
    expect(screen.getByText('Regular item')).toBeInTheDocument()
    expect(screen.getByTitle('Pin memory')).toBeInTheDocument()
  })

  // ─── Pin / Unpin / Delete ───

  it('pin button calls contextPinMemory and sets isPinned true in store', async () => {
    setTabWithoutProject()
    const memoryId = 'mem-pin-1'
    const memories = [makeMemory({ id: memoryId, isPinned: false })]
    useContextStore.setState({ panelOpen: true, activeSection: 'memories', memories })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    await act(async () => {
      fireEvent.click(screen.getByTitle('Pin memory'))
    })
    await flushAsync()

    expect(window.clui.contextPinMemory).toHaveBeenCalledWith(memoryId)
    expect(useContextStore.getState().memories.find((m) => m.id === memoryId)?.isPinned).toBe(true)
  })

  it('unpin button calls contextUnpinMemory and sets isPinned false in store', async () => {
    setTabWithoutProject()
    const memoryId = 'mem-unpin-1'
    const memories = [makeMemory({ id: memoryId, isPinned: true })]
    useContextStore.setState({ panelOpen: true, activeSection: 'memories', memories })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    await act(async () => {
      fireEvent.click(screen.getByTitle('Unpin memory'))
    })
    await flushAsync()

    expect(window.clui.contextUnpinMemory).toHaveBeenCalledWith(memoryId)
    expect(useContextStore.getState().memories.find((m) => m.id === memoryId)?.isPinned).toBe(false)
  })

  it('delete button calls contextDeleteMemory and removes item from store', async () => {
    setTabWithoutProject()
    const memories = [
      makeMemory({ id: 'del-1', title: 'First' }),
      makeMemory({ id: 'del-2', title: 'Second' }),
    ]
    useContextStore.setState({ panelOpen: true, activeSection: 'memories', memories })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    const deleteButtons = screen.getAllByTitle('Delete memory')
    await act(async () => {
      fireEvent.click(deleteButtons[0])
    })
    await flushAsync()

    expect(window.clui.contextDeleteMemory).toHaveBeenCalledWith('del-1')
    const remaining = useContextStore.getState().memories
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('del-2')
  })

  // ─── Search ───

  it('search input updates searchQuery and triggers IPC after debounce', async () => {
    setTabWithProject()
    const searchResults = [makeMemory({ title: 'Found' })]
    ;(window.clui.contextSearchMemories as ReturnType<typeof vi.fn>).mockResolvedValue(searchResults)
    useContextStore.setState({ panelOpen: true, activeSection: 'memories', memories: [] })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    ;(window.clui.contextSearchMemories as ReturnType<typeof vi.fn>).mockClear()
    ;(window.clui.contextSearchMemories as ReturnType<typeof vi.fn>).mockResolvedValue(searchResults)

    const input = screen.getByPlaceholderText('Search memories...')
    await act(async () => {
      fireEvent.change(input, { target: { value: 'found' } })
    })

    expect(useContextStore.getState().searchQuery).toBe('found')

    await act(async () => {
      await new Promise((r) => setTimeout(r, 400))
    })

    expect(window.clui.contextSearchMemories).toHaveBeenCalledWith('C:/project', 'found', 50)
  })

  // ─── Sessions section ───

  it('shows empty state when no sessions exist', async () => {
    setTabWithoutProject()
    useContextStore.setState({ panelOpen: true, activeSection: 'sessions', sessionHistory: [] })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    expect(screen.getByText('No session history yet')).toBeInTheDocument()
  })

  it('renders session card with status, title, and metadata', async () => {
    setTabWithoutProject()
    const sessions = [makeSession({
      title: 'Bug fix session',
      filesTouchedCount: 4,
      durationMs: 65000,
      toolsUsed: ['Read', 'Edit', 'Bash'],
      summary: 'Fixed login bug',
    })]
    useContextStore.setState({ panelOpen: true, activeSection: 'sessions', sessionHistory: sessions })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    expect(screen.getByText('Bug fix session')).toBeInTheDocument()
    expect(screen.getByText('completed')).toBeInTheDocument()
    expect(screen.getByText('4 files')).toBeInTheDocument()
    expect(screen.getByText('1m5s')).toBeInTheDocument()
    expect(screen.getByText('3 tools')).toBeInTheDocument()
    expect(screen.getByText('Fixed login bug')).toBeInTheDocument()
  })

  // ─── Files section ───

  it('shows empty state when no files recorded', async () => {
    setTabWithoutProject()
    useContextStore.setState({ panelOpen: true, activeSection: 'files', filesTouched: [] })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    expect(screen.getByText('No file activity recorded')).toBeInTheDocument()
  })

  it('renders file table with path, touches, and actions', () => {
    setTabWithoutProject()
    const files = [
      { path: 'src/index.ts', totalTouches: 5, actions: ['read', 'write'], lastTouched: '2026-03-15T10:00:00Z', sessionCount: 2 },
      { path: 'src/main.ts', totalTouches: 7, actions: ['write'], lastTouched: '2026-03-16T10:00:00Z', sessionCount: 1 },
    ]
    useContextStore.setState({ panelOpen: true, activeSection: 'files', filesTouched: files })
    renderWithProviders(<ContextPanel />)

    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('read')).toBeInTheDocument()
    expect(screen.getAllByText('write')).toHaveLength(2)
    expect(screen.getByText('src/main.ts')).toBeInTheDocument()
  })

  // ─── Preview section ───

  it('renders XML preview block when data available', () => {
    useContextStore.setState({
      panelOpen: true,
      activeSection: 'preview',
      memoryPacketPreview: '<clui_context>test data</clui_context>',
      isLoading: false,
    })
    renderWithProviders(<ContextPanel />)

    expect(screen.getByText('<clui_context>test data</clui_context>')).toBeInTheDocument()
  })

  it('shows empty message when no preview available', () => {
    useContextStore.setState({
      panelOpen: true,
      activeSection: 'preview',
      memoryPacketPreview: null,
      isLoading: false,
    })
    renderWithProviders(<ContextPanel />)

    expect(screen.getByText('No context data available for this project')).toBeInTheDocument()
  })

  // ─── Project stats ───

  it('shows project stats summary when available', async () => {
    setTabWithoutProject()
    useContextStore.setState({
      panelOpen: true,
      projectStats: {
        projectId: 'p1',
        projectName: 'Test',
        sessionCount: 5,
        totalCostUsd: 0.5,
        uniqueFilesTouched: 10,
        memoryCount: 3,
        lastActiveAt: new Date().toISOString(),
      },
    })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    expect(screen.getByText('5 sessions, 3 memories, 10 files')).toBeInTheDocument()
  })

  it('shows "No context data yet" when stats are null', async () => {
    setTabWithoutProject()
    useContextStore.setState({ panelOpen: true, projectStats: null })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    expect(screen.getByText('No context data yet')).toBeInTheDocument()
  })

  // ─── Loading state ───

  it('renders without crashing when isLoading is true', async () => {
    setTabWithoutProject()
    useContextStore.setState({ panelOpen: true, isLoading: true })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    expect(screen.getByTestId('context-panel')).toBeInTheDocument()
    expect(screen.getByText('Context Database')).toBeInTheDocument()
  })

  // ─── Data loading on open ───

  it('calls all load IPCs when panel opens with a valid project path', () => {
    setTabWithProject()
    useContextStore.setState({ panelOpen: true })
    renderWithProviders(<ContextPanel />)

    expect(window.clui.contextSearchMemories).toHaveBeenCalled()
    expect(window.clui.contextGetSessionHistory).toHaveBeenCalled()
    expect(window.clui.contextGetFilesTouched).toHaveBeenCalled()
    expect(window.clui.contextGetProjectStats).toHaveBeenCalled()
  })

  it('skips loading when no project path is set', async () => {
    setTabWithoutProject()
    useContextStore.setState({ panelOpen: true })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    expect(window.clui.contextSearchMemories).not.toHaveBeenCalled()
    expect(window.clui.contextGetSessionHistory).not.toHaveBeenCalled()
  })

  // ─── Event listeners ───

  it('registers broadcast event listeners on mount', async () => {
    useContextStore.setState({ panelOpen: true })
    renderWithProviders(<ContextPanel />)
    await flushAsync()

    expect(window.clui.onContextMemoryCreated).toHaveBeenCalled()
    expect(window.clui.onContextSessionRecorded).toHaveBeenCalled()
  })
})
