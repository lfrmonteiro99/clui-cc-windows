import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DatabaseService } from '../../src/main/context/database-service'
import { IngestionService } from '../../src/main/context/ingestion-service'
import { __initSqlWasm } from '../__mocks__/better-sqlite3'

beforeAll(async () => {
  await __initSqlWasm()
})

describe('CTX-005: Early goal extraction', () => {
  let tempDir: string
  let db: DatabaseService
  let ingestion: IngestionService

  const PROJECT_PATH = '/home/user/my-project'

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clui-goal-test-'))
    const dbPath = join(tempDir, 'test.sqlite')
    const blobsPath = join(tempDir, 'blobs')
    db = new DatabaseService(dbPath, blobsPath)
    db.init()
    ingestion = new IngestionService(db)
  })

  afterEach(() => {
    ingestion.shutdown()
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function setupTab(tabId: string): void {
    ingestion.initTab(tabId, PROJECT_PATH)
    ingestion.ensureSession(tabId, PROJECT_PATH)
  }

  function getSessionGoal(sessionId: string): string | null {
    const row = db.db
      .prepare('SELECT goal FROM sessions WHERE id = ?')
      .get(sessionId) as { goal: string | null } | undefined
    return row?.goal ?? null
  }

  // ── Test: first user message triggers goal extraction ────────────────

  it('extracts goal from first substantial user prompt', () => {
    const tabId = 'tab-goal-1'
    setupTab(tabId)
    const state = ingestion._getTabState(tabId)!

    ingestion.ingestUserMessage(tabId, 'req-1', 'Refactor the authentication module to use JWT tokens instead of sessions', [])

    const goal = getSessionGoal(state.sessionId!)
    expect(goal).toBe('Refactor the authentication module to use JWT tokens instead of sessions')
  })

  // ── Test: goal is stored on session record ───────────────────────────

  it('stores goal on session record via updateSession', () => {
    const tabId = 'tab-goal-2'
    setupTab(tabId)
    const state = ingestion._getTabState(tabId)!

    const prompt = 'Implement a new caching layer for the API responses'
    ingestion.ingestUserMessage(tabId, 'req-1', prompt, [])

    // Verify it's actually in the sessions table
    const row = db.db
      .prepare('SELECT goal FROM sessions WHERE id = ?')
      .get(state.sessionId!) as { goal: string | null }
    expect(row.goal).toBe(prompt)
  })

  // ── Test: subsequent messages don't overwrite the goal ───────────────

  it('does not overwrite goal on subsequent messages', () => {
    const tabId = 'tab-goal-3'
    setupTab(tabId)
    const state = ingestion._getTabState(tabId)!

    const firstPrompt = 'Fix the login page CSS layout issues'
    ingestion.ingestUserMessage(tabId, 'req-1', firstPrompt, [])

    // Second message should not overwrite
    ingestion.ingestUserMessage(tabId, 'req-2', 'Actually, also fix the signup page', [])

    // Third message should not overwrite either
    ingestion.ingestUserMessage(tabId, 'req-3', 'And add some unit tests for both', [])

    const goal = getSessionGoal(state.sessionId!)
    expect(goal).toBe(firstPrompt)
  })

  // ── Test: goal is refined (updated) at session completion ────────────

  it('refines goal at session completion if goal already exists', () => {
    const tabId = 'tab-goal-4'
    setupTab(tabId)
    const state = ingestion._getTabState(tabId)!

    // Set initial goal via first message
    ingestion.ingestUserMessage(tabId, 'req-1', 'Fix the login page CSS layout issues', [])

    // Complete the session — should NOT replace the existing goal
    ingestion.ingest(tabId, {
      type: 'task_complete',
      result: 'Fixed CSS layout and added responsive breakpoints',
      costUsd: 0.03,
      durationMs: 20000,
      numTurns: 5,
      usage: { input_tokens: 300, output_tokens: 150 },
      sessionId: 'claude-sess-1',
    })

    // Goal should still be the original (not replaced by task_complete)
    const goal = getSessionGoal(state.sessionId!)
    expect(goal).toBe('Fix the login page CSS layout issues')
  })

  // ── Test: very short prompts (<10 chars) don't trigger goal extraction

  it('does not extract goal from very short prompts (<10 chars)', () => {
    const tabId = 'tab-goal-5'
    setupTab(tabId)
    const state = ingestion._getTabState(tabId)!

    ingestion.ingestUserMessage(tabId, 'req-1', 'hi', [])

    const goal = getSessionGoal(state.sessionId!)
    expect(goal).toBeNull()
  })

  it('does not extract goal from prompts that are exactly 9 chars', () => {
    const tabId = 'tab-goal-6'
    setupTab(tabId)
    const state = ingestion._getTabState(tabId)!

    ingestion.ingestUserMessage(tabId, 'req-1', '123456789', [])

    const goal = getSessionGoal(state.sessionId!)
    expect(goal).toBeNull()
  })

  it('extracts goal from prompts that are exactly 10 chars', () => {
    const tabId = 'tab-goal-7'
    setupTab(tabId)
    const state = ingestion._getTabState(tabId)!

    ingestion.ingestUserMessage(tabId, 'req-1', '1234567890', [])

    const goal = getSessionGoal(state.sessionId!)
    expect(goal).toBe('1234567890')
  })

  // ── Test: goal is truncated at 200 chars ─────────────────────────────

  it('truncates goal to 200 characters for very long prompts', () => {
    const tabId = 'tab-goal-8'
    setupTab(tabId)
    const state = ingestion._getTabState(tabId)!

    const longPrompt = 'A'.repeat(300)
    ingestion.ingestUserMessage(tabId, 'req-1', longPrompt, [])

    const goal = getSessionGoal(state.sessionId!)
    expect(goal).not.toBeNull()
    expect(goal!.length).toBe(200)
    expect(goal).toBe('A'.repeat(200))
  })

  // ── Test: goal extraction does not break if db.updateSession throws ──

  it('does not throw if goal update fails', () => {
    const tabId = 'tab-goal-err'
    setupTab(tabId)

    // Sabotage updateSession for goal setting
    const originalUpdateSession = db.updateSession.bind(db)
    let callCount = 0
    db.updateSession = (...args: Parameters<typeof db.updateSession>) => {
      callCount++
      if (callCount === 1) {
        throw new Error('DB write failed')
      }
      return originalUpdateSession(...args)
    }

    // Should not throw — error is caught internally
    expect(() => {
      ingestion.ingestUserMessage(tabId, 'req-1', 'Fix the broken test suite that fails on CI', [])
    }).not.toThrow()

    db.updateSession = originalUpdateSession
  })

  // ── Test: task_complete sets goal if no goal was set (short first message) ──

  it('sets goal from task_complete result when no early goal exists', () => {
    const tabId = 'tab-goal-late'
    setupTab(tabId)
    const state = ingestion._getTabState(tabId)!

    // Short first message — no goal extracted
    ingestion.ingestUserMessage(tabId, 'req-1', 'hi', [])

    // Complete the session with a result
    ingestion.ingest(tabId, {
      type: 'task_complete',
      result: 'Completed the requested changes to the authentication module',
      costUsd: 0.02,
      durationMs: 10000,
      numTurns: 2,
      usage: { input_tokens: 200, output_tokens: 100 },
      sessionId: 'claude-sess-1',
    })

    // Goal should be set from the task_complete result since no early goal existed
    const goal = getSessionGoal(state.sessionId!)
    expect(goal).not.toBeNull()
    expect(goal).toBe('Completed the requested changes to the authentication module')
  })
})
