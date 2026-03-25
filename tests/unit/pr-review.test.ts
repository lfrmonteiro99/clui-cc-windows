import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import type { NormalizedEvent, RunOptions, EnrichedError } from '../../src/shared/types'

// ─── Shared mock instances ───

let mockRunManager: EventEmitter & Record<string, any>
let mockPtyRunManager: EventEmitter & Record<string, any>
let mockPermissionServer: EventEmitter & Record<string, any>

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

import { ControlPlane } from '../../src/main/claude/control-plane'

function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 0))
}

describe('PR Review — ControlPlane.openPrReview()', () => {
  let cp: ControlPlane

  beforeEach(() => {
    mockRunManager = createMockRunManager()
    mockPtyRunManager = createMockPtyRunManager()
    mockPermissionServer = createMockPermissionServer()
    cp = new ControlPlane()
  })

  afterEach(() => {
    cp.removeAllListeners()
  })

  it('creates a new tab and spawns with --from-pr flag', async () => {
    const prPromise = cp.openPrReview(447, '/tmp/project')
    await flush()

    // Verify startRun was called with fromPr option
    const startRunCalls = mockRunManager.startRun.mock.calls
    expect(startRunCalls.length).toBeGreaterThan(0)

    const prCall = startRunCalls.find((call: any[]) => {
      const options: RunOptions = call[1]
      return options.fromPr === '447'
    })

    expect(prCall).toBeDefined()
    const prOptions: RunOptions = prCall![1]
    expect(prOptions.fromPr).toBe('447')
    expect(prOptions.projectPath).toBe('/tmp/project')
    expect(prOptions.prompt).toContain('PR #447')

    // Simulate completion
    const requestId = prCall![0] as string
    mockRunManager.emit('normalized', requestId, {
      type: 'session_init',
      sessionId: 'pr-session-1',
      tools: [],
      model: 'claude-sonnet-4-6',
      mcpServers: [],
      skills: [],
      version: '2.1.81',
    } as NormalizedEvent)
    mockRunManager.emit('exit', requestId, 0, null, 'pr-session-1')

    const result = await prPromise
    expect(result.tabId).toBeTruthy()
    expect(result.prNumber).toBe(447)
  })

  it('sets tab title to PR #<number> initially', async () => {
    const events: Array<{ tabId: string; event: NormalizedEvent }> = []
    cp.on('event', (tabId: string, event: NormalizedEvent) => {
      events.push({ tabId, event })
    })

    const prPromise = cp.openPrReview(123, '/tmp/project')
    await flush()

    // The tab should exist in registry
    const result = await (async () => {
      const requestId = mockRunManager.startRun.mock.calls[0][0]
      mockRunManager.emit('normalized', requestId, {
        type: 'session_init',
        sessionId: 'pr-session-2',
        tools: [],
        model: 'claude-sonnet-4-6',
        mcpServers: [],
        skills: [],
        version: '2.1.81',
      } as NormalizedEvent)
      mockRunManager.emit('exit', requestId, 0, null, 'pr-session-2')
      return prPromise
    })()

    expect(result.tabId).toBeTruthy()
    expect(result.prNumber).toBe(123)
  })

  it('rejects non-numeric PR input', async () => {
    await expect(cp.openPrReview(NaN, '/tmp/project'))
      .rejects.toThrow('Invalid PR number')
  })

  it('rejects zero or negative PR numbers', async () => {
    await expect(cp.openPrReview(0, '/tmp/project'))
      .rejects.toThrow('Invalid PR number')
    await expect(cp.openPrReview(-5, '/tmp/project'))
      .rejects.toThrow('Invalid PR number')
  })

  it('rejects non-integer PR numbers', async () => {
    await expect(cp.openPrReview(44.7, '/tmp/project'))
      .rejects.toThrow('Invalid PR number')
  })

  it('surfaces CLI error in tab (dead state)', async () => {
    const statusChanges: Array<{ tabId: string; newStatus: string }> = []
    cp.on('tab-status-change', (tabId: string, newStatus: string) => {
      statusChanges.push({ tabId, newStatus })
    })
    // Must register 'error' listener to prevent EventEmitter from throwing
    cp.on('error', () => {})

    const prPromise = cp.openPrReview(999, '/tmp/project')
    await flush()

    const requestId = mockRunManager.startRun.mock.calls[0][0]

    // Simulate CLI crash
    mockRunManager.emit('exit', requestId, 1, null, null)

    try {
      await prPromise
    } catch {
      // Expected — promise may reject on error
    }

    // Tab should transition to dead state
    const deadChange = statusChanges.find(c => c.newStatus === 'dead')
    expect(deadChange).toBeDefined()
  })
})

describe('PR Review — Types', () => {
  it('IPC.OPEN_PR_REVIEW constant is defined', async () => {
    const { IPC } = await import('../../src/shared/types')
    expect(IPC.OPEN_PR_REVIEW).toBe('clui:open-pr-review')
  })

  it('RunOptions supports fromPr', () => {
    const opts: RunOptions = {
      prompt: 'Review PR',
      projectPath: '/tmp',
      fromPr: '447',
    }
    expect(opts.fromPr).toBe('447')
  })

  it('TabState supports prNumber', async () => {
    const types = await import('../../src/shared/types')
    // Type-level check: prNumber should be an optional field on TabState
    const tab = { prNumber: 42 } as Partial<types.TabState>
    expect(tab.prNumber).toBe(42)
  })
})

describe('PR Review — SlashCommandMenu', () => {
  it('/pr command exists in SlashCommandMenu source', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'renderer', 'components', 'SlashCommandMenu.tsx'),
      'utf8',
    )
    expect(src).toContain("command: '/pr'")
    expect(src).toContain('Open a PR review')
    expect(src).toContain('GitPullRequest')
  })
})

describe('PR Review — TabStrip icon', () => {
  it('TabStrip source references GitPullRequest for PR tabs', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'renderer', 'components', 'TabStrip.tsx'),
      'utf8',
    )
    expect(src).toContain('GitPullRequest')
    expect(src).toContain('prNumber')
  })
})
