import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * CTX-001: Inject git status into smart context packet
 *
 * Tests that:
 * 1. _dispatch calls getStatus and passes files to buildSmartPacket
 * 2. Smart packet includes <git_status> section when in a git repo
 * 3. Git files are capped at 15
 * 4. Graceful fallback if git call fails
 * 5. No git section when not in a git repo
 */

// ── Mocks ────────────────────────────────────────────────────────────────

// We test the RetrievalService.assembleSmartPacket git_status injection
// and the ControlPlane._dispatch git status fetching separately.

// ── Part A: assembleSmartPacket includes <git_status> ────────────────────

describe('assembleSmartPacket git_status tier', () => {
  // We need to access the private assembleSmartPacket method.
  // We'll import RetrievalService and use a workaround to call the private method.

  // Mock the database service
  const mockDb = {
    db: {},
    getProjectByPath: vi.fn(),
  }

  let RetrievalServiceClass: any

  beforeEach(async () => {
    vi.resetModules()
    // We need to mock the database dependency
    const mod = await import('../../src/main/context/retrieval-service')
    RetrievalServiceClass = mod.RetrievalService
  })

  function callAssemble(
    service: any,
    projectSection: string,
    tiers: Record<string, string>,
    config?: any,
  ): string {
    // Access private method via bracket notation
    return service['assembleSmartPacket'](projectSection, tiers, config ?? {
      totalBudget: 5000,
      tierBudgets: {},
      minDecisionImportance: 0.4,
      minPitfallImportance: 0.3,
      maxDecisions: 5,
      maxPitfalls: 4,
      maxPatterns: 5,
      cooccurrenceMinWeight: 3.0,
    })
  }

  it('includes <git_status> section with branch and files', () => {
    const service = new RetrievalServiceClass(mockDb as any)
    const projectSection = '<project name="test" path="/tmp/test">Sessions: 1</project>'

    const tiers = {
      continuation: '',
      decisions: '',
      pitfalls: '',
      hotFiles: '',
      patterns: '',
      memories: '',
      sessions: '',
      gitStatus: '<git_status branch="main" file_count="3">\nM src/foo.ts\nA src/bar.ts\nD old.ts\n</git_status>',
    }

    const result = callAssemble(service, projectSection, tiers)
    expect(result).toContain('<git_status')
    expect(result).toContain('branch="main"')
    expect(result).toContain('M src/foo.ts')
    expect(result).toContain('</git_status>')
  })

  it('does not include <git_status> when gitStatus tier is empty', () => {
    const service = new RetrievalServiceClass(mockDb as any)
    const projectSection = '<project name="test" path="/tmp/test">Sessions: 1</project>'

    const tiers = {
      continuation: '',
      decisions: '',
      pitfalls: '',
      hotFiles: '',
      patterns: '',
      memories: '',
      sessions: '',
      gitStatus: '',
    }

    const result = callAssemble(service, projectSection, tiers)
    expect(result).not.toContain('<git_status')
  })
})

// ── Part B: buildSmartPacket passes gitDiffFiles and builds git_status ───

describe('buildSmartPacket git_status integration', () => {
  it('builds git_status tier from gitDiffFiles parameter', async () => {
    vi.resetModules()

    const mod = await import('../../src/main/context/retrieval-service')
    const RetrievalServiceClass = mod.RetrievalService

    // Create a minimal mock DB that returns enough for buildSmartPacket
    const mockDbInstance = {
      db: {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue(undefined), // project not found => returns null
          all: vi.fn().mockReturnValue([]),
        }),
      },
      getProjectByPath: vi.fn(),
    }

    const service = new RetrievalServiceClass(mockDbInstance as any)

    // We test buildGitStatusTier directly (private method)
    const gitFiles = [
      { status: 'M' as const, path: 'src/foo.ts' },
      { status: 'A' as const, path: 'src/bar.ts' },
    ]

    const result = service['buildGitStatusTier']('main', gitFiles)
    expect(result).toContain('<git_status')
    expect(result).toContain('branch="main"')
    expect(result).toContain('M src/foo.ts')
    expect(result).toContain('A src/bar.ts')
    expect(result).toContain('file_count="2"')
  })

  it('caps git files at 15', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/context/retrieval-service')
    const RetrievalServiceClass = mod.RetrievalService

    const mockDbInstance = {
      db: { prepare: vi.fn().mockReturnValue({ get: vi.fn(), all: vi.fn().mockReturnValue([]) }) },
      getProjectByPath: vi.fn(),
    }

    const service = new RetrievalServiceClass(mockDbInstance as any)

    // Create 20 files
    const gitFiles = Array.from({ length: 20 }, (_, i) => ({
      status: 'M' as const,
      path: `src/file${i}.ts`,
    }))

    const result = service['buildGitStatusTier']('feature-branch', gitFiles)
    expect(result).toContain('file_count="15"')
    // Should contain file14 but not file15
    expect(result).toContain('src/file14.ts')
    expect(result).not.toContain('src/file15.ts')
    // Should note truncation
    expect(result).toContain('...and 5 more')
  })

  it('returns empty string when no branch and no files', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/context/retrieval-service')
    const RetrievalServiceClass = mod.RetrievalService

    const mockDbInstance = {
      db: { prepare: vi.fn().mockReturnValue({ get: vi.fn(), all: vi.fn().mockReturnValue([]) }) },
      getProjectByPath: vi.fn(),
    }

    const service = new RetrievalServiceClass(mockDbInstance as any)

    const result = service['buildGitStatusTier'](null, [])
    expect(result).toBe('')
  })
})

// ── Part C: ControlPlane._dispatch fetches git status ───────────────────

import { EventEmitter } from 'events'
import type { NormalizedEvent, RunOptions, EnrichedError } from '../../src/shared/types'

let mockRunManager: EventEmitter & Record<string, any>
let mockPtyRunManager: EventEmitter & Record<string, any>
let mockPermissionServer: EventEmitter & Record<string, any>
let mockGitContextProvider: Record<string, any>

function createMockRunManager() {
  const m = new EventEmitter() as EventEmitter & Record<string, any>
  m.startRun = vi.fn(() => ({ pid: 1234 }))
  m.cancel = vi.fn(() => true)
  m.isRunning = vi.fn(() => false)
  m.getEnrichedError = vi.fn((_reqId: string, exitCode: number | null): EnrichedError => ({
    message: `Run failed with exit code ${exitCode}`,
    stderrTail: ['some error'],
    stdoutTail: [],
    exitCode,
    elapsedMs: 100,
    toolCallCount: 0,
  }))
  m.writeToStdin = vi.fn(() => true)
  return m
}

function createMockPtyRunManager() {
  const m = new EventEmitter() as EventEmitter & Record<string, any>
  m.startRun = vi.fn(() => ({ pid: 5678 }))
  m.cancel = vi.fn(() => true)
  m.isRunning = vi.fn(() => false)
  m.getEnrichedError = vi.fn((_reqId: string, exitCode: number | null): EnrichedError => ({
    message: `PTY run failed with exit code ${exitCode}`,
    stderrTail: [],
    stdoutTail: [],
    exitCode,
    elapsedMs: 50,
    toolCallCount: 0,
  }))
  m.respondToPermission = vi.fn(() => true)
  return m
}

function createMockPermissionServer() {
  const m = new EventEmitter() as EventEmitter & Record<string, any>
  m.start = vi.fn(() => Promise.resolve(19836))
  m.stop = vi.fn()
  m.getPort = vi.fn(() => 19836)
  m.registerRun = vi.fn(() => 'run-token-1')
  m.unregisterRun = vi.fn()
  m.respondToPermission = vi.fn(() => true)
  m.generateSettingsFile = vi.fn(() => '/tmp/clui-hook-settings.json')
  return m
}

mockRunManager = createMockRunManager()
mockPtyRunManager = createMockPtyRunManager()
mockPermissionServer = createMockPermissionServer()
mockGitContextProvider = {
  getStatus: vi.fn(),
}

vi.mock('../../src/main/claude/run-manager', () => ({
  RunManager: function RunManager() { return mockRunManager },
}))

vi.mock('../../src/main/claude/pty-run-manager', () => ({
  PtyRunManager: function PtyRunManager() { return mockPtyRunManager },
}))

vi.mock('../../src/main/hooks/permission-server', () => ({
  PermissionServer: function PermissionServer() { return mockPermissionServer },
  maskSensitiveFields: (input: Record<string, unknown>) => input,
}))

vi.mock('../../src/main/agent-memory', () => ({
  AgentMemory: function AgentMemory() {},
}))

vi.mock('../../src/main/logger', () => ({
  log: () => {},
}))

vi.mock('../../src/main/git-context', () => ({
  GitContextProvider: function GitContextProvider() { return mockGitContextProvider },
}))

import { ControlPlane } from '../../src/main/claude/control-plane'

function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 0))
}

describe('ControlPlane._dispatch git status injection', () => {
  let cp: ControlPlane

  beforeEach(() => {
    mockRunManager = createMockRunManager()
    mockPtyRunManager = createMockPtyRunManager()
    mockPermissionServer = createMockPermissionServer()
    mockGitContextProvider = {
      getStatus: vi.fn(),
    }
    cp = new ControlPlane()
  })

  it('calls getStatus with projectPath and passes files to buildSmartPacket', async () => {
    const tabId = cp.createTab()

    // Mock git status returning modified files
    mockGitContextProvider.getStatus = vi.fn().mockResolvedValue({
      isRepo: true,
      branch: 'feature-x',
      files: [
        { status: 'M', path: 'src/foo.ts' },
        { status: 'A', path: 'src/bar.ts' },
      ],
    })

    // Mock retrieval service
    const mockRetrievalService = {
      resolveProjectId: vi.fn().mockReturnValue('proj-1'),
      buildSmartPacket: vi.fn().mockReturnValue('<clui_context>mock</clui_context>'),
    }
    cp.setRetrievalService(mockRetrievalService as any)
    cp.setGitContextProvider(mockGitContextProvider as any)

    const opts: RunOptions = { prompt: 'test', projectPath: '/tmp/project' }
    const promise = cp.submitPrompt(tabId, 'req-1', opts)
    await flush()

    // Verify getStatus was called with the project path
    expect(mockGitContextProvider.getStatus).toHaveBeenCalledWith('/tmp/project')

    // Verify buildSmartPacket received gitDiffFiles, branch, and file statuses
    expect(mockRetrievalService.buildSmartPacket).toHaveBeenCalledWith(
      'proj-1',
      tabId,
      'test',
      ['src/foo.ts', 'src/bar.ts'],
      undefined,
      'feature-x',
      [
        { status: 'M', path: 'src/foo.ts' },
        { status: 'A', path: 'src/bar.ts' },
      ],
    )

    // Clean up
    mockRunManager.emit('exit', 'req-1', 0, null, null)
    await promise
  })

  it('passes empty array when not in a git repo', async () => {
    const tabId = cp.createTab()

    mockGitContextProvider.getStatus = vi.fn().mockResolvedValue({
      isRepo: false,
      branch: null,
      files: [],
    })

    const mockRetrievalService = {
      resolveProjectId: vi.fn().mockReturnValue('proj-1'),
      buildSmartPacket: vi.fn().mockReturnValue(null),
    }
    cp.setRetrievalService(mockRetrievalService as any)
    cp.setGitContextProvider(mockGitContextProvider as any)

    const opts: RunOptions = { prompt: 'test', projectPath: '/tmp/project' }
    const promise = cp.submitPrompt(tabId, 'req-1', opts)
    await flush()

    expect(mockRetrievalService.buildSmartPacket).toHaveBeenCalledWith(
      'proj-1',
      tabId,
      'test',
      [],
      undefined,
      null,
      [],
    )

    mockRunManager.emit('exit', 'req-1', 0, null, null)
    await promise
  })

  it('gracefully handles git status failure and passes empty array', async () => {
    const tabId = cp.createTab()

    mockGitContextProvider.getStatus = vi.fn().mockRejectedValue(new Error('git not found'))

    const mockRetrievalService = {
      resolveProjectId: vi.fn().mockReturnValue('proj-1'),
      buildSmartPacket: vi.fn().mockReturnValue(null),
    }
    cp.setRetrievalService(mockRetrievalService as any)
    cp.setGitContextProvider(mockGitContextProvider as any)

    const opts: RunOptions = { prompt: 'test', projectPath: '/tmp/project' }
    const promise = cp.submitPrompt(tabId, 'req-1', opts)
    await flush()

    // Should still call buildSmartPacket with empty array (graceful fallback)
    expect(mockRetrievalService.buildSmartPacket).toHaveBeenCalledWith(
      'proj-1',
      tabId,
      'test',
      [],
      undefined,
      null,
      [],
    )

    mockRunManager.emit('exit', 'req-1', 0, null, null)
    await promise
  })

  it('skips git status when no projectPath is set', async () => {
    const tabId = cp.createTab()

    mockGitContextProvider.getStatus = vi.fn()

    const mockRetrievalService = {
      resolveProjectId: vi.fn().mockReturnValue('proj-1'),
      buildSmartPacket: vi.fn().mockReturnValue(null),
    }
    cp.setRetrievalService(mockRetrievalService as any)
    cp.setGitContextProvider(mockGitContextProvider as any)

    // No projectPath
    const opts: RunOptions = { prompt: 'test' }
    const promise = cp.submitPrompt(tabId, 'req-1', opts)
    await flush()

    // getStatus should not be called without a project path
    expect(mockGitContextProvider.getStatus).not.toHaveBeenCalled()

    mockRunManager.emit('exit', 'req-1', 0, null, null)
    await promise
  })
})
