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

// Initialize before vi.mock runs (hoisted)
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

function makeRunOptions(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    prompt: 'Hello',
    projectPath: '/tmp/project',
    ...overrides,
  }
}

/**
 * Flush microtasks so that the async _dispatch() (which awaits hookServerReady)
 * can complete startRun and register the inflight promise. Without this, emitting
 * exit/error events synchronously after submitPrompt would fire before the
 * inflight is registered, causing tests to hang.
 */
function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 0))
}

function emitRunExit(requestId: string, code: number | null, signal: string | null = null, sessionId: string | null = null) {
  mockRunManager.emit('exit', requestId, code, signal, sessionId)
}

function emitRunError(requestId: string, err: Error) {
  mockRunManager.emit('error', requestId, err)
}

function emitNormalized(requestId: string, event: NormalizedEvent) {
  mockRunManager.emit('normalized', requestId, event)
}

describe('ControlPlane', () => {
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

  // ─────────────────────────────────────────────────────────────
  // Tab Lifecycle
  // ─────────────────────────────────────────────────────────────

  describe('Tab Lifecycle', () => {
    it('createTab returns a unique tab ID with status idle', () => {
      const tabId = cp.createTab()
      expect(tabId).toBeTruthy()
      expect(typeof tabId).toBe('string')

      const status = cp.getTabStatus(tabId)
      expect(status).toBeDefined()
      expect(status!.status).toBe('idle')
      expect(status!.claudeSessionId).toBeNull()
      expect(status!.activeRequestId).toBeNull()
      expect(status!.runPid).toBeNull()
      expect(status!.promptCount).toBe(0)
    })

    it('createTab returns unique IDs for each call', () => {
      const id1 = cp.createTab()
      const id2 = cp.createTab()
      const id3 = cp.createTab()
      expect(id1).not.toBe(id2)
      expect(id2).not.toBe(id3)
    })

    it('closeTab removes the tab from registry', () => {
      const tabId = cp.createTab()
      cp.closeTab(tabId)
      expect(cp.getTabStatus(tabId)).toBeUndefined()
    })

    it('closeTab is a no-op for nonexistent tab', () => {
      cp.closeTab('nonexistent-tab-id')
    })

    it('closeTab cancels active run and rejects inflight promise', async () => {
      const tabId = cp.createTab()
      const promise = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      expect(cp.getTabStatus(tabId)!.activeRequestId).toBe('req-1')

      cp.closeTab(tabId)

      expect(mockRunManager.cancel).toHaveBeenCalledWith('req-1')
      await expect(promise).rejects.toThrow('Tab closed')
      expect(cp.getTabStatus(tabId)).toBeUndefined()
    })

    it('closeTab rejects all queued requests for that tab', async () => {
      const tabId = cp.createTab()

      const p1 = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()
      const p2 = cp.submitPrompt(tabId, 'req-2', makeRunOptions())
      const p3 = cp.submitPrompt(tabId, 'req-3', makeRunOptions())

      cp.closeTab(tabId)

      await expect(p1).rejects.toThrow('Tab closed')
      await expect(p2).rejects.toThrow('Tab closed')
      await expect(p3).rejects.toThrow('Tab closed')
    })

    it('closeTab with no active run just removes the tab', () => {
      const tabId = cp.createTab()
      cp.closeTab(tabId)
      expect(cp.getTabStatus(tabId)).toBeUndefined()
      expect(mockRunManager.cancel).not.toHaveBeenCalled()
    })

    it('resetTabSession clears the stored session ID', async () => {
      const tabId = cp.createTab()

      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      emitNormalized('req-1', {
        type: 'session_init',
        sessionId: 'sess-abc',
        tools: [],
        model: 'claude-sonnet-4-5-20250514',
        mcpServers: [],
        skills: [],
        version: '2.1.71',
      })
      emitRunExit('req-1', 0)
      await p

      expect(cp.getTabStatus(tabId)!.claudeSessionId).toBe('sess-abc')

      cp.resetTabSession(tabId)
      expect(cp.getTabStatus(tabId)!.claudeSessionId).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Status Transitions
  // ─────────────────────────────────────────────────────────────

  describe('Status Transitions', () => {
    it('first submitPrompt transitions tab to connecting (no prior session)', async () => {
      const tabId = cp.createTab()
      const statusChanges: string[] = []
      cp.on('tab-status-change', (id: string, newStatus: string) => {
        if (id === tabId) statusChanges.push(newStatus)
      })

      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      expect(statusChanges).toContain('connecting')

      emitRunExit('req-1', 0)
    })

    it('submitPrompt with existing session transitions directly to running', async () => {
      const tabId = cp.createTab()

      // First run: establish a session
      const p1 = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()
      emitNormalized('req-1', {
        type: 'session_init',
        sessionId: 'sess-1',
        tools: [],
        model: 'claude-sonnet-4-5-20250514',
        mcpServers: [],
        skills: [],
        version: '2.1.71',
      })
      emitRunExit('req-1', 0)
      await p1

      // Track status changes for second run
      const statusChanges: string[] = []
      cp.on('tab-status-change', (_id: string, newStatus: string) => {
        statusChanges.push(newStatus)
      })

      const p2 = cp.submitPrompt(tabId, 'req-2', makeRunOptions())
      await flush()
      // Should go to 'running' since we already have a session
      expect(statusChanges).toContain('running')

      emitRunExit('req-2', 0)
      await p2
    })

    it('session_init event transitions connecting to running', async () => {
      const tabId = cp.createTab()
      const statusChanges: string[] = []
      cp.on('tab-status-change', (_id: string, newStatus: string) => {
        statusChanges.push(newStatus)
      })

      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      emitNormalized('req-1', {
        type: 'session_init',
        sessionId: 'sess-1',
        tools: [],
        model: 'claude-sonnet-4-5-20250514',
        mcpServers: [],
        skills: [],
        version: '2.1.71',
      })

      expect(statusChanges).toContain('connecting')
      expect(statusChanges).toContain('running')
      expect(cp.getTabStatus(tabId)!.claudeSessionId).toBe('sess-1')

      emitRunExit('req-1', 0)
    })

    it('exit code 0 transitions to completed', async () => {
      const tabId = cp.createTab()
      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      emitRunExit('req-1', 0)
      await p

      expect(cp.getTabStatus(tabId)!.status).toBe('completed')
    })

    it('exit with SIGINT transitions to failed', async () => {
      const tabId = cp.createTab()
      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      emitRunExit('req-1', null, 'SIGINT')
      await p

      expect(cp.getTabStatus(tabId)!.status).toBe('failed')
    })

    it('exit with SIGKILL transitions to failed', async () => {
      const tabId = cp.createTab()
      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      emitRunExit('req-1', null, 'SIGKILL')
      await p

      expect(cp.getTabStatus(tabId)!.status).toBe('failed')
    })

    it('unexpected exit code transitions to dead and emits session_dead + enriched error', async () => {
      const tabId = cp.createTab()
      const events: NormalizedEvent[] = []
      const errors: EnrichedError[] = []

      cp.on('event', (_id: string, evt: NormalizedEvent) => {
        events.push(evt)
      })
      cp.on('error', (_id: string, err: EnrichedError) => {
        errors.push(err)
      })

      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      emitRunExit('req-1', 137)
      await p

      expect(cp.getTabStatus(tabId)!.status).toBe('dead')

      const deadEvent = events.find(e => e.type === 'session_dead')
      expect(deadEvent).toBeDefined()
      expect(deadEvent!.type === 'session_dead' && deadEvent!.exitCode).toBe(137)

      expect(errors).toHaveLength(1)
      expect(mockRunManager.getEnrichedError).toHaveBeenCalledWith('req-1', 137)
    })

    it('RunManager error event transitions to dead', async () => {
      const tabId = cp.createTab()
      const errors: EnrichedError[] = []
      cp.on('error', (_id: string, err: EnrichedError) => {
        errors.push(err)
      })

      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      emitRunError('req-1', new Error('spawn ENOENT'))

      await expect(p).rejects.toThrow('spawn ENOENT')
      expect(cp.getTabStatus(tabId)!.status).toBe('dead')
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('spawn ENOENT')
    })

    it('session_init during warmup emits isWarmup flag without status change', async () => {
      const tabId = cp.createTab()
      const events: NormalizedEvent[] = []
      cp.on('event', (_id: string, evt: NormalizedEvent) => {
        events.push(evt)
      })

      cp.initSession(tabId)
      await flush()

      const initRequestId = `init-${tabId}`

      emitNormalized(initRequestId, {
        type: 'session_init',
        sessionId: 'sess-warm',
        tools: ['Read'],
        model: 'claude-sonnet-4-5-20250514',
        mcpServers: [],
        skills: [],
        version: '2.1.71',
      })

      const warmupEvent = events.find(
        e => e.type === 'session_init' && (e as any).isWarmup === true
      )
      expect(warmupEvent).toBeDefined()

      emitRunExit(initRequestId, 0)
    })

    it('init request events are suppressed except session_init', async () => {
      const tabId = cp.createTab()
      const events: NormalizedEvent[] = []
      cp.on('event', (_id: string, evt: NormalizedEvent) => {
        events.push(evt)
      })

      cp.initSession(tabId)
      await flush()
      const initRequestId = `init-${tabId}`

      emitNormalized(initRequestId, {
        type: 'session_init',
        sessionId: 'sess-warm',
        tools: [],
        model: 'claude-sonnet-4-5-20250514',
        mcpServers: [],
        skills: [],
        version: '2.1.71',
      })

      emitNormalized(initRequestId, { type: 'text_chunk', text: 'hi' })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('session_init')

      emitRunExit(initRequestId, 0)
    })

    it('init request exit silently transitions to idle and processes queue', async () => {
      const tabId = cp.createTab()
      const statusChanges: string[] = []
      cp.on('tab-status-change', (_id: string, newStatus: string) => {
        statusChanges.push(newStatus)
      })

      cp.initSession(tabId)
      await flush()
      const initRequestId = `init-${tabId}`

      emitRunExit(initRequestId, 0)

      await flush()

      expect(statusChanges).toContain('idle')
    })

    it('exit clears activeRequestId and runPid on tab', async () => {
      const tabId = cp.createTab()
      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      expect(cp.getTabStatus(tabId)!.activeRequestId).toBe('req-1')
      expect(cp.getTabStatus(tabId)!.runPid).toBe(1234)

      emitRunExit('req-1', 0)
      await p

      expect(cp.getTabStatus(tabId)!.activeRequestId).toBeNull()
      expect(cp.getTabStatus(tabId)!.runPid).toBeNull()
    })

    it('exit preserves session ID from exit event', async () => {
      const tabId = cp.createTab()
      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      emitRunExit('req-1', 0, null, 'sess-from-exit')
      await p

      expect(cp.getTabStatus(tabId)!.claudeSessionId).toBe('sess-from-exit')
    })

    it('exit for already-closed tab resolves orphaned promise without error', async () => {
      const tabId = cp.createTab()
      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      cp.closeTab(tabId)

      // Exit fires after tab is gone
      emitRunExit('req-1', 0)

      // p was already rejected by closeTab
      await expect(p).rejects.toThrow('Tab closed')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Request Queue
  // ─────────────────────────────────────────────────────────────

  describe('Request Queue', () => {
    it('submitPrompt when tab idle dispatches immediately', async () => {
      const tabId = cp.createTab()
      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      expect(mockRunManager.startRun).toHaveBeenCalledTimes(1)
      expect(cp.getTabStatus(tabId)!.activeRequestId).toBe('req-1')

      emitRunExit('req-1', 0)
    })

    it('submitPrompt when tab busy queues the request', async () => {
      const tabId = cp.createTab()

      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      cp.submitPrompt(tabId, 'req-2', makeRunOptions())

      expect(mockRunManager.startRun).toHaveBeenCalledTimes(1)

      emitRunExit('req-1', 0)
      await flush()

      expect(mockRunManager.startRun).toHaveBeenCalledTimes(2)

      emitRunExit('req-2', 0)
    })

    it('submitPrompt when queue full rejects with backpressure error', async () => {
      const tabId = cp.createTab()

      cp.submitPrompt(tabId, 'req-0', makeRunOptions())
      await flush()

      const queuedPromises: Promise<void>[] = []
      for (let i = 1; i <= 32; i++) {
        queuedPromises.push(cp.submitPrompt(tabId, `req-${i}`, makeRunOptions()))
      }

      await expect(
        cp.submitPrompt(tabId, 'req-33', makeRunOptions())
      ).rejects.toThrow('Request queue full')

      // Clean up
      emitRunExit('req-0', 0)
      for (let i = 1; i <= 32; i++) {
        await flush()
        emitRunExit(`req-${i}`, 0)
      }
    })

    it('duplicate requestId returns existing inflight promise (idempotency)', async () => {
      const tabId = cp.createTab()

      const p1 = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      const p2 = cp.submitPrompt(tabId, 'req-1', makeRunOptions())

      // Only one startRun call should have occurred — the duplicate reuses the inflight
      expect(mockRunManager.startRun).toHaveBeenCalledTimes(1)

      emitRunExit('req-1', 0)

      // Both promises should resolve
      await expect(p1).resolves.toBeUndefined()
      await expect(p2).resolves.toBeUndefined()
    })

    it('duplicate requestId already in queue adds extra waiter', async () => {
      const tabId = cp.createTab()

      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      const p2 = cp.submitPrompt(tabId, 'req-2', makeRunOptions())
      const p3 = cp.submitPrompt(tabId, 'req-2', makeRunOptions())

      expect(p2).not.toBe(p3)

      emitRunExit('req-1', 0)
      await flush()

      emitRunExit('req-2', 0)

      await expect(p2).resolves.toBeUndefined()
      await expect(p3).resolves.toBeUndefined()
    })

    it('queue processes next request for same tab after run exits', async () => {
      const tabId = cp.createTab()

      const p1 = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      const p2 = cp.submitPrompt(tabId, 'req-2', makeRunOptions())

      emitRunExit('req-1', 0)
      await p1
      await flush()

      expect(mockRunManager.startRun).toHaveBeenCalledTimes(2)

      emitRunExit('req-2', 0)
      await p2
    })

    it('submitPrompt rejects when tabId is empty', async () => {
      await expect(
        cp.submitPrompt('', 'req-1', makeRunOptions())
      ).rejects.toThrow('No targetSession (tabId) provided')
    })

    it('submitPrompt rejects when tab does not exist', async () => {
      await expect(
        cp.submitPrompt('nonexistent', 'req-1', makeRunOptions())
      ).rejects.toThrow('does not exist')
    })

    it('promptCount increments only for non-init requests', async () => {
      const tabId = cp.createTab()
      expect(cp.getTabStatus(tabId)!.promptCount).toBe(0)

      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      expect(cp.getTabStatus(tabId)!.promptCount).toBe(1)

      emitRunExit('req-1', 0)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Permission Mode
  // ─────────────────────────────────────────────────────────────

  describe('Permission Mode', () => {
    it('auto mode auto-approves permission requests', () => {
      const tabId = cp.createTab()
      cp.setPermissionMode('auto')

      mockPermissionServer.emit(
        'permission-request',
        'hook-q1',
        { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
        tabId,
        [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }],
      )

      expect(mockPermissionServer.respondToPermission).toHaveBeenCalledWith(
        'hook-q1', 'allow', 'Auto mode'
      )
    })

    it('ask mode forwards permission_request event to renderer', () => {
      const tabId = cp.createTab()
      cp.setPermissionMode('ask')

      const events: NormalizedEvent[] = []
      cp.on('event', (_id: string, evt: NormalizedEvent) => {
        events.push(evt)
      })

      mockPermissionServer.emit(
        'permission-request',
        'hook-q2',
        { tool_name: 'Bash', tool_input: { command: 'ls' } },
        tabId,
        [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }],
      )

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('permission_request')
      if (events[0].type === 'permission_request') {
        expect(events[0].questionId).toBe('hook-q2')
        expect(events[0].toolName).toBe('Bash')
      }
    })

    it('permission for closed tab auto-denies', () => {
      const tabId = cp.createTab()
      cp.closeTab(tabId)

      mockPermissionServer.emit(
        'permission-request',
        'hook-q3',
        { tool_name: 'Edit', tool_input: {} },
        tabId,
        [{ id: 'allow', label: 'Allow' }],
      )

      expect(mockPermissionServer.respondToPermission).toHaveBeenCalledWith(
        'hook-q3', 'deny', 'Tab closed'
      )
    })

    it('respondToPermission routes hook-prefixed questions to permission server', () => {
      const tabId = cp.createTab()
      cp.respondToPermission(tabId, 'hook-q1', 'allow')

      expect(mockPermissionServer.respondToPermission).toHaveBeenCalledWith(
        'hook-q1', 'allow'
      )
    })

    it('respondToPermission routes non-hook questions to RunManager stdin', async () => {
      const tabId = cp.createTab()
      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      const result = cp.respondToPermission(tabId, 'perm-q1', 'allow')

      expect(mockRunManager.writeToStdin).toHaveBeenCalledWith('req-1', {
        type: 'permission_response',
        question_id: 'perm-q1',
        option_id: 'allow',
      })
      expect(result).toBe(true)

      emitRunExit('req-1', 0)
    })

    it('respondToPermission returns false when tab has no active request', () => {
      const tabId = cp.createTab()
      const result = cp.respondToPermission(tabId, 'perm-q1', 'allow')
      expect(result).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Cancel
  // ─────────────────────────────────────────────────────────────

  describe('Cancel', () => {
    it('cancel active run delegates to RunManager.cancel', async () => {
      const tabId = cp.createTab()
      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      const result = cp.cancel('req-1')
      expect(result).toBe(true)
      expect(mockRunManager.cancel).toHaveBeenCalledWith('req-1')

      emitRunExit('req-1', null, 'SIGINT')
    })

    it('cancel queued request removes from queue and rejects', async () => {
      const tabId = cp.createTab()

      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()
      const p2 = cp.submitPrompt(tabId, 'req-2', makeRunOptions())

      const result = cp.cancel('req-2')
      expect(result).toBe(true)

      await expect(p2).rejects.toThrow('Request cancelled')

      expect(mockRunManager.cancel).not.toHaveBeenCalledWith('req-2')

      emitRunExit('req-1', 0)
    })

    it('cancel queued request also rejects extra waiters', async () => {
      const tabId = cp.createTab()

      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()
      const p2 = cp.submitPrompt(tabId, 'req-2', makeRunOptions())
      const p3 = cp.submitPrompt(tabId, 'req-2', makeRunOptions()) // extra waiter

      cp.cancel('req-2')

      await expect(p2).rejects.toThrow('Request cancelled')
      await expect(p3).rejects.toThrow('Request cancelled')

      emitRunExit('req-1', 0)
    })

    it('cancelTab cancels by tab ID', async () => {
      const tabId = cp.createTab()
      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      const result = cp.cancelTab(tabId)
      expect(result).toBe(true)
      expect(mockRunManager.cancel).toHaveBeenCalledWith('req-1')

      emitRunExit('req-1', null, 'SIGINT')
    })

    it('cancelTab returns false when no active request', () => {
      const tabId = cp.createTab()
      expect(cp.cancelTab(tabId)).toBe(false)
    })

    it('cancelTab returns false for nonexistent tab', () => {
      expect(cp.cancelTab('nonexistent')).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Retry
  // ─────────────────────────────────────────────────────────────

  describe('Retry', () => {
    it('retry on dead tab sets idle then submits', async () => {
      const tabId = cp.createTab()
      // Must add error listener to prevent Node.js "Unhandled error" on EventEmitter
      cp.on('error', () => {})

      const p1 = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()
      emitRunExit('req-1', 137)
      await p1

      expect(cp.getTabStatus(tabId)!.status).toBe('dead')

      const statusChanges: string[] = []
      cp.on('tab-status-change', (_id: string, newStatus: string) => {
        statusChanges.push(newStatus)
      })

      const p2 = cp.retry(tabId, 'req-2', makeRunOptions())
      await flush()

      // idle first, then connecting
      expect(statusChanges[0]).toBe('idle')
      expect(statusChanges[1]).toBe('connecting')

      emitRunExit('req-2', 0)
      await p2

      expect(cp.getTabStatus(tabId)!.status).toBe('completed')
    })

    it('retry on non-dead tab just submits without idle transition', async () => {
      const tabId = cp.createTab()

      const p1 = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()
      emitRunExit('req-1', 0)
      await p1

      const statusChanges: string[] = []
      cp.on('tab-status-change', (_id: string, newStatus: string) => {
        statusChanges.push(newStatus)
      })

      const p2 = cp.retry(tabId, 'req-2', makeRunOptions())
      await flush()

      expect(statusChanges[0]).not.toBe('idle')

      emitRunExit('req-2', 0)
      await p2
    })

    it('retry preserves stored session ID for resume', async () => {
      const tabId = cp.createTab()
      cp.on('error', () => {})

      const p1 = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()
      emitNormalized('req-1', {
        type: 'session_init',
        sessionId: 'sess-keep',
        tools: [],
        model: 'claude-sonnet-4-5-20250514',
        mcpServers: [],
        skills: [],
        version: '2.1.71',
      })
      emitRunExit('req-1', 137)
      await p1

      expect(cp.getTabStatus(tabId)!.claudeSessionId).toBe('sess-keep')

      const p2 = cp.retry(tabId, 'req-2', makeRunOptions())
      await flush()

      const startRunCalls = mockRunManager.startRun.mock.calls
      const lastOpts = startRunCalls[startRunCalls.length - 1][1]
      expect(lastOpts.sessionId).toBe('sess-keep')

      emitRunExit('req-2', 0)
      await p2
    })

    it('retry rejects for nonexistent tab', async () => {
      await expect(
        cp.retry('nonexistent', 'req-1', makeRunOptions())
      ).rejects.toThrow('does not exist')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Health
  // ─────────────────────────────────────────────────────────────

  describe('Health', () => {
    it('getHealth returns correct tab statuses and queue depth', async () => {
      const tab1 = cp.createTab()
      const tab2 = cp.createTab()

      cp.submitPrompt(tab1, 'req-1', makeRunOptions())
      await flush()
      cp.submitPrompt(tab1, 'req-2', makeRunOptions())

      const health = cp.getHealth()

      expect(health.tabs).toHaveLength(2)
      expect(health.queueDepth).toBe(1)

      const tab1Health = health.tabs.find(t => t.tabId === tab1)
      expect(tab1Health).toBeDefined()
      expect(tab1Health!.activeRequestId).toBe('req-1')
      expect(tab1Health!.status).toBe('connecting')

      const tab2Health = health.tabs.find(t => t.tabId === tab2)
      expect(tab2Health).toBeDefined()
      expect(tab2Health!.status).toBe('idle')
      expect(tab2Health!.alive).toBe(false)

      // Clean up
      emitRunExit('req-1', 0)
      await flush()
      emitRunExit('req-2', 0)
    })

    it('getHealth reflects alive status from RunManager', async () => {
      const tabId = cp.createTab()
      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      mockRunManager.isRunning.mockReturnValueOnce(true)

      const health = cp.getHealth()
      const tabHealth = health.tabs.find(t => t.tabId === tabId)
      expect(tabHealth!.alive).toBe(true)

      emitRunExit('req-1', 0)
    })

    it('getHealth shows empty when no tabs', () => {
      const health = cp.getHealth()
      expect(health.tabs).toHaveLength(0)
      expect(health.queueDepth).toBe(0)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Event Routing
  // ─────────────────────────────────────────────────────────────

  describe('Event Routing', () => {
    it('normalized events are tagged with tabId and forwarded', async () => {
      const tabId = cp.createTab()
      const events: Array<{ tabId: string; event: NormalizedEvent }> = []
      cp.on('event', (id: string, evt: NormalizedEvent) => {
        events.push({ tabId: id, event: evt })
      })

      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      emitNormalized('req-1', { type: 'text_chunk', text: 'Hello world' })

      expect(events).toHaveLength(1)
      expect(events[0].tabId).toBe(tabId)
      expect(events[0].event.type).toBe('text_chunk')

      emitRunExit('req-1', 0)
    })

    it('events for unknown requestIds are silently dropped', () => {
      const events: NormalizedEvent[] = []
      cp.on('event', (_id: string, evt: NormalizedEvent) => {
        events.push(evt)
      })

      emitNormalized('unknown-req', { type: 'text_chunk', text: 'orphan' })

      expect(events).toHaveLength(0)
    })

    it('lastActivityAt is updated on normalized events', async () => {
      const tabId = cp.createTab()
      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      const before = cp.getTabStatus(tabId)!.lastActivityAt

      await new Promise(r => setTimeout(r, 5))

      emitNormalized('req-1', { type: 'text_chunk', text: 'tick' })

      const after = cp.getTabStatus(tabId)!.lastActivityAt
      expect(after).toBeGreaterThanOrEqual(before)

      emitRunExit('req-1', 0)
    })

    it('tab-status-change event includes old and new status', async () => {
      const tabId = cp.createTab()
      const changes: Array<{ newStatus: string; oldStatus: string }> = []
      cp.on('tab-status-change', (_id: string, newStatus: string, oldStatus: string) => {
        changes.push({ newStatus, oldStatus })
      })

      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      emitRunExit('req-1', 0)
      await p

      // idle -> connecting -> completed
      expect(changes).toContainEqual({ newStatus: 'connecting', oldStatus: 'idle' })
      expect(changes).toContainEqual({ newStatus: 'completed', oldStatus: 'connecting' })
    })

    it('duplicate status transition is suppressed (no event emitted)', async () => {
      const tabId = cp.createTab()
      const changes: string[] = []
      cp.on('tab-status-change', (_id: string, newStatus: string) => {
        changes.push(newStatus)
      })

      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      // After flush, connecting status change should have fired exactly once
      const connectingCount = changes.filter(s => s === 'connecting').length
      expect(connectingCount).toBe(1)

      emitRunExit('req-1', 0)
      await p
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Dispatch & Hook Server
  // ─────────────────────────────────────────────────────────────

  describe('Dispatch', () => {
    it('registers per-run token with permission server', async () => {
      const tabId = cp.createTab()
      cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      expect(mockPermissionServer.registerRun).toHaveBeenCalledWith(
        tabId, 'req-1', null
      )
      expect(mockPermissionServer.generateSettingsFile).toHaveBeenCalledWith(
        'run-token-1', undefined
      )

      emitRunExit('req-1', 0)
    })

    it('unregisters per-run token on exit', async () => {
      const tabId = cp.createTab()
      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      emitRunExit('req-1', 0)
      await p

      expect(mockPermissionServer.unregisterRun).toHaveBeenCalledWith('run-token-1')
    })

    it('unregisters per-run token on error', async () => {
      const tabId = cp.createTab()
      cp.on('error', () => {})
      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      emitRunError('req-1', new Error('crash'))

      await expect(p).rejects.toThrow('crash')
      expect(mockPermissionServer.unregisterRun).toHaveBeenCalledWith('run-token-1')
    })

    it('uses stored session ID for resume when not overridden', async () => {
      const tabId = cp.createTab()

      // First run: establish session
      const p1 = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()
      emitNormalized('req-1', {
        type: 'session_init',
        sessionId: 'sess-resume',
        tools: [],
        model: 'claude-sonnet-4-5-20250514',
        mcpServers: [],
        skills: [],
        version: '2.1.71',
      })
      emitRunExit('req-1', 0)
      await p1

      // Second run: should inject stored session ID
      const p2 = cp.submitPrompt(tabId, 'req-2', makeRunOptions())
      await flush()

      const startRunCalls = mockRunManager.startRun.mock.calls
      const lastOpts = startRunCalls[startRunCalls.length - 1][1]
      expect(lastOpts.sessionId).toBe('sess-resume')

      emitRunExit('req-2', 0)
      await p2
    })

    it('does not override explicit sessionId in options', async () => {
      const tabId = cp.createTab()

      // First run: establish session
      const p1 = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()
      emitNormalized('req-1', {
        type: 'session_init',
        sessionId: 'sess-stored',
        tools: [],
        model: 'claude-sonnet-4-5-20250514',
        mcpServers: [],
        skills: [],
        version: '2.1.71',
      })
      emitRunExit('req-1', 0)
      await p1

      // Second run with explicit sessionId
      const p2 = cp.submitPrompt(tabId, 'req-2', makeRunOptions({ sessionId: 'sess-explicit' }))
      await flush()

      const startRunCalls = mockRunManager.startRun.mock.calls
      const lastOpts = startRunCalls[startRunCalls.length - 1][1]
      expect(lastOpts.sessionId).toBe('sess-explicit')

      emitRunExit('req-2', 0)
      await p2
    })

    it('startRun failure sets tab to failed and throws', async () => {
      const tabId = cp.createTab()
      mockRunManager.startRun.mockImplementationOnce(() => {
        throw new Error('Binary not found')
      })

      await expect(
        cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      ).rejects.toThrow('Binary not found')

      expect(cp.getTabStatus(tabId)!.status).toBe('failed')
      expect(cp.getTabStatus(tabId)!.activeRequestId).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Agent Memory Integration
  // ─────────────────────────────────────────────────────────────

  describe('Agent Memory', () => {
    it('setAgentMemory stores memory and prunes stale tabs', () => {
      const mockMemory = {
        pruneStaleTabs: vi.fn(),
        buildPromptContext: vi.fn(),
        getSnapshot: vi.fn(),
      }

      cp.createTab()
      cp.setAgentMemory(mockMemory as any)

      expect(mockMemory.pruneStaleTabs).toHaveBeenCalled()
    })

    it('getAgentMemorySnapshot returns empty snapshot when no memory set', () => {
      const snapshot = cp.getAgentMemorySnapshot('/tmp/project')
      expect(snapshot).toEqual({
        projectPath: '/tmp/project',
        active: [],
        recentDone: [],
      })
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Retrieval Service Integration
  // ─────────────────────────────────────────────────────────────

  describe('Retrieval Service', () => {
    it('injects memory packet into system prompt when retrieval service is set', async () => {
      const mockRetrieval = {
        resolveProjectId: vi.fn(() => 'proj-1'),
        buildMemoryPacket: vi.fn(() => 'Context: remembered stuff'),
        buildSmartPacket: vi.fn(() => 'Context: remembered stuff'),
      }
      cp.setRetrievalService(mockRetrieval as any)

      const tabId = cp.createTab()
      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions({ projectPath: '/my/project' }))
      await flush()

      const startRunCalls = mockRunManager.startRun.mock.calls
      const lastOpts = startRunCalls[startRunCalls.length - 1][1]
      expect(lastOpts.systemPrompt).toContain('Context: remembered stuff')

      emitRunExit('req-1', 0)
      await p
    })

    it('does not inject memory packet when project has no ID', async () => {
      const mockRetrieval = {
        resolveProjectId: vi.fn(() => null),
        buildMemoryPacket: vi.fn(),
        buildSmartPacket: vi.fn(),
      }
      cp.setRetrievalService(mockRetrieval as any)

      const tabId = cp.createTab()
      const p = cp.submitPrompt(tabId, 'req-1', makeRunOptions())
      await flush()

      expect(mockRetrieval.buildSmartPacket).not.toHaveBeenCalled()

      emitRunExit('req-1', 0)
      await p
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Shutdown
  // ─────────────────────────────────────────────────────────────

  describe('Shutdown', () => {
    it('shutdown stops permission server and closes all tabs', () => {
      const tab1 = cp.createTab()
      const tab2 = cp.createTab()

      cp.shutdown()

      expect(mockPermissionServer.stop).toHaveBeenCalled()
      expect(cp.getTabStatus(tab1)).toBeUndefined()
      expect(cp.getTabStatus(tab2)).toBeUndefined()
    })
  })

  // ─────────────────────────────────────────────────────────────
  // getEnrichedError
  // ─────────────────────────────────────────────────────────────

  describe('getEnrichedError', () => {
    it('delegates to RunManager for non-PTY runs', () => {
      cp.getEnrichedError('req-1', 1)
      expect(mockRunManager.getEnrichedError).toHaveBeenCalledWith('req-1', 1)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // getTabStatus
  // ─────────────────────────────────────────────────────────────

  describe('getTabStatus', () => {
    it('returns undefined for nonexistent tab', () => {
      expect(cp.getTabStatus('nonexistent')).toBeUndefined()
    })

    it('returns the full TabRegistryEntry', () => {
      const tabId = cp.createTab()
      const entry = cp.getTabStatus(tabId)

      expect(entry).toBeDefined()
      expect(entry!.tabId).toBe(tabId)
      expect(entry!.runtime).toBe('native')
      expect(entry!.wslDistro).toBeNull()
      expect(typeof entry!.createdAt).toBe('number')
      expect(typeof entry!.lastActivityAt).toBe('number')
    })
  })
})
