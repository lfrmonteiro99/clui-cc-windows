import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useContextStore } from '../../../src/renderer/stores/contextStore'
import type { ContextMemory, ContextSessionSummary, MemorySearchResult } from '../../../src/shared/context-types'

function makeMemory(overrides: Partial<MemorySearchResult> = {}): MemorySearchResult {
  return {
    id: overrides.id || crypto.randomUUID(),
    memoryType: 'session_outcome',
    scope: 'project',
    title: 'Test memory',
    body: 'Test body',
    importanceScore: 0.7,
    confidenceScore: 1.0,
    isPinned: false,
    accessCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeSession(overrides: Partial<ContextSessionSummary> = {}): ContextSessionSummary {
  return {
    id: overrides.id || crypto.randomUUID(),
    title: 'Test session',
    goal: null,
    status: 'completed',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    filesTouchedCount: 2,
    toolsUsed: ['Read', 'Edit'],
    costUsd: 0.01,
    durationMs: 5000,
    summary: 'Did some work',
    ...overrides,
  }
}

function installCluiMock() {
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
  ;(globalThis as any).window = { clui: mock }
  return mock
}

describe('contextStore', () => {
  let cluiMock: ReturnType<typeof installCluiMock>

  beforeEach(() => {
    cluiMock = installCluiMock()
    useContextStore.setState(useContextStore.getInitialState(), true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Panel state ──

  it('starts with panel closed', () => {
    expect(useContextStore.getState().panelOpen).toBe(false)
  })

  it('openPanel sets panelOpen to true', () => {
    useContextStore.getState().openPanel()
    expect(useContextStore.getState().panelOpen).toBe(true)
  })

  it('closePanel sets panelOpen to false', () => {
    useContextStore.setState({ panelOpen: true })
    useContextStore.getState().closePanel()
    expect(useContextStore.getState().panelOpen).toBe(false)
  })

  it('togglePanel flips panelOpen', () => {
    useContextStore.getState().togglePanel()
    expect(useContextStore.getState().panelOpen).toBe(true)
    useContextStore.getState().togglePanel()
    expect(useContextStore.getState().panelOpen).toBe(false)
  })

  it('setActiveSection changes section', () => {
    useContextStore.getState().setActiveSection('sessions')
    expect(useContextStore.getState().activeSection).toBe('sessions')
  })

  it('setSearchQuery changes query', () => {
    useContextStore.getState().setSearchQuery('test')
    expect(useContextStore.getState().searchQuery).toBe('test')
  })

  // ── Load memories ──

  it('loadMemories fetches and stores memories', async () => {
    const memories = [makeMemory(), makeMemory()]
    cluiMock.contextSearchMemories.mockResolvedValue(memories)

    await useContextStore.getState().loadMemories('/project', 'query')

    expect(cluiMock.contextSearchMemories).toHaveBeenCalledWith('/project', 'query', 50)
    expect(useContextStore.getState().memories).toEqual(memories)
    expect(useContextStore.getState().isLoading).toBe(false)
  })

  it('loadMemories handles errors gracefully', async () => {
    cluiMock.contextSearchMemories.mockRejectedValue(new Error('fail'))

    await useContextStore.getState().loadMemories('/project')

    expect(useContextStore.getState().memories).toEqual([])
    expect(useContextStore.getState().isLoading).toBe(false)
  })

  // ── Load session history ──

  it('loadSessionHistory fetches and stores sessions', async () => {
    const sessions = [makeSession(), makeSession()]
    cluiMock.contextGetSessionHistory.mockResolvedValue(sessions)

    await useContextStore.getState().loadSessionHistory('/project')

    expect(cluiMock.contextGetSessionHistory).toHaveBeenCalledWith('/project', 20, 0)
    expect(useContextStore.getState().sessionHistory).toEqual(sessions)
    expect(useContextStore.getState().isLoading).toBe(false)
  })

  // ── Load project stats ──

  it('loadProjectStats fetches and stores stats', async () => {
    const stats = {
      projectId: 'p1',
      projectName: 'Test',
      sessionCount: 5,
      totalCostUsd: 0.5,
      uniqueFilesTouched: 10,
      memoryCount: 3,
      lastActiveAt: new Date().toISOString(),
    }
    cluiMock.contextGetProjectStats.mockResolvedValue(stats)

    await useContextStore.getState().loadProjectStats('/project')

    expect(useContextStore.getState().projectStats).toEqual(stats)
  })

  // ── Load files touched ──

  it('loadFilesTouched fetches and stores files', async () => {
    const files = [
      { path: 'src/index.ts', totalTouches: 5, actions: ['read', 'write'], lastTouched: new Date().toISOString(), sessionCount: 2 },
    ]
    cluiMock.contextGetFilesTouched.mockResolvedValue(files)

    await useContextStore.getState().loadFilesTouched('/project')

    expect(cluiMock.contextGetFilesTouched).toHaveBeenCalledWith('/project', 50)
    expect(useContextStore.getState().filesTouched).toEqual(files)
  })

  // ── Load packet preview ──

  it('loadPacketPreview fetches and stores preview', async () => {
    cluiMock.contextGetMemoryPacketPreview.mockResolvedValue('<clui_context>test</clui_context>')

    await useContextStore.getState().loadPacketPreview('/project', 'tab1', 'fix the bug')

    expect(cluiMock.contextGetMemoryPacketPreview).toHaveBeenCalledWith('/project', 'tab1', 'fix the bug')
    expect(useContextStore.getState().memoryPacketPreview).toBe('<clui_context>test</clui_context>')
  })

  // ── Pin/unpin/delete memory ──

  it('pinMemory calls IPC and updates local state', async () => {
    const mem = makeMemory({ id: 'm1', isPinned: false })
    useContextStore.setState({ memories: [mem] })

    await useContextStore.getState().pinMemory('m1')

    expect(cluiMock.contextPinMemory).toHaveBeenCalledWith('m1')
    expect(useContextStore.getState().memories[0].isPinned).toBe(true)
  })

  it('unpinMemory calls IPC and updates local state', async () => {
    const mem = makeMemory({ id: 'm1', isPinned: true })
    useContextStore.setState({ memories: [mem] })

    await useContextStore.getState().unpinMemory('m1')

    expect(cluiMock.contextUnpinMemory).toHaveBeenCalledWith('m1')
    expect(useContextStore.getState().memories[0].isPinned).toBe(false)
  })

  it('deleteMemory calls IPC and removes from local state', async () => {
    const mem1 = makeMemory({ id: 'm1' })
    const mem2 = makeMemory({ id: 'm2' })
    useContextStore.setState({ memories: [mem1, mem2] })

    await useContextStore.getState().deleteMemory('m1')

    expect(cluiMock.contextDeleteMemory).toHaveBeenCalledWith('m1')
    expect(useContextStore.getState().memories).toHaveLength(1)
    expect(useContextStore.getState().memories[0].id).toBe('m2')
  })

  // ── Event handlers ──

  it('handleMemoryCreated prepends to memories list', () => {
    const existing = makeMemory({ id: 'old' })
    useContextStore.setState({ memories: [existing] })

    const newMemory: ContextMemory = {
      id: 'new',
      memoryType: 'session_outcome',
      scope: 'project',
      title: 'New memory',
      body: null,
      importanceScore: 0.8,
      confidenceScore: 1.0,
      isPinned: false,
      accessCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    useContextStore.getState().handleMemoryCreated(newMemory)

    const memories = useContextStore.getState().memories
    expect(memories).toHaveLength(2)
    expect(memories[0].id).toBe('new')
    expect(memories[1].id).toBe('old')
  })

  it('handleSessionRecorded prepends to session history', () => {
    const existing = makeSession({ id: 'old' })
    useContextStore.setState({ sessionHistory: [existing] })

    const newSession = makeSession({ id: 'new', title: 'New session' })

    useContextStore.getState().handleSessionRecorded(newSession)

    const history = useContextStore.getState().sessionHistory
    expect(history).toHaveLength(2)
    expect(history[0].id).toBe('new')
    expect(history[1].id).toBe('old')
  })
})
