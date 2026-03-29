/**
 * CompanionNarrator — generates live commentary during idle gaps via Haiku CLI.
 *
 * When the main Claude agent is between tool calls with idle gaps of 3+ seconds,
 * spawns a background Haiku CLI call to produce 1-2 sentence contextual commentary.
 * Commentary appears as distinct "companion" messages in the chat.
 */
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { StreamParser } from '../stream-parser'
import { resolveClaudeEntryPoint } from '../platform'
import { log as _log } from '../logger'
import type { ClaudeEntryPoint } from '../platform'
import type { NormalizedEvent } from '../../shared/types'

const IDLE_GAP_MS = 3_000
const RATE_LIMIT_MS = 8_000
const MAX_CONTEXT_BUFFER = 10
const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const HAIKU_TIMEOUT_MS = 15_000
const SETTINGS_PATH = join(homedir(), '.clui', 'companion-settings.json')

function log(msg: string): void {
  _log('CompanionNarrator', msg)
}

interface ToolCallEntry {
  toolName: string
  toolId: string
  partialInput: string
}

type BroadcastFn = (tabId: string, event: NormalizedEvent) => void

interface CompanionSettings {
  enabled: boolean
}

interface TabIdleState {
  timer: ReturnType<typeof setTimeout> | null
  lastCommentaryAt: number
  contextBuffer: ToolCallEntry[]
  active: boolean
}

export class CompanionNarrator {
  private entryPoint: ClaudeEntryPoint
  private broadcast: BroadcastFn
  private tabStates = new Map<string, TabIdleState>()
  private enabled: boolean

  constructor(broadcast: BroadcastFn, entryPoint?: ClaudeEntryPoint) {
    this.broadcast = broadcast
    this.entryPoint = entryPoint ?? resolveClaudeEntryPoint()
    this.enabled = this._loadSettings().enabled
  }

  // ─── Settings ───

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this._saveSettings({ enabled })
    if (!enabled) {
      this._clearAllTimers()
    }
  }

  // ─── Event Handler ───

  onEvent(tabId: string, event: NormalizedEvent): void {
    if (!this.enabled) return

    switch (event.type) {
      case 'session_init': {
        // Start tracking this tab
        this.tabStates.set(tabId, {
          timer: null,
          lastCommentaryAt: 0,
          contextBuffer: [],
          active: true,
        })
        break
      }

      case 'tool_call': {
        const state = this._getOrCreateState(tabId)
        if (!state.active) break
        // Add to context buffer (rolling window)
        state.contextBuffer.push({
          toolName: event.toolName,
          toolId: event.toolId,
          partialInput: '',
        })
        if (state.contextBuffer.length > MAX_CONTEXT_BUFFER) {
          state.contextBuffer.shift()
        }
        this._resetIdleTimer(tabId, state)
        break
      }

      case 'tool_call_update': {
        const state = this.tabStates.get(tabId)
        if (!state?.active) break
        // Update the latest matching tool call's partial input
        const entry = [...state.contextBuffer].reverse().find((e) => e.toolId === event.toolId)
        if (entry) {
          entry.partialInput += event.partialInput
          // Cap partial input to prevent memory bloat
          if (entry.partialInput.length > 500) {
            entry.partialInput = entry.partialInput.slice(0, 500)
          }
        }
        break
      }

      case 'tool_call_complete':
      case 'text_chunk': {
        const state = this.tabStates.get(tabId)
        if (!state?.active) break
        this._resetIdleTimer(tabId, state)
        break
      }

      case 'task_complete':
      case 'session_dead':
      case 'error': {
        this._stopTracking(tabId)
        break
      }
    }
  }

  // ─── Internal: Idle Timer ───

  private _getOrCreateState(tabId: string): TabIdleState {
    let state = this.tabStates.get(tabId)
    if (!state) {
      state = {
        timer: null,
        lastCommentaryAt: 0,
        contextBuffer: [],
        active: true,
      }
      this.tabStates.set(tabId, state)
    }
    return state
  }

  private _resetIdleTimer(tabId: string, state: TabIdleState): void {
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }
    state.timer = setTimeout(() => {
      this._onIdleGap(tabId)
    }, IDLE_GAP_MS)
  }

  private _onIdleGap(tabId: string): void {
    const state = this.tabStates.get(tabId)
    if (!state?.active) return

    // Rate limit: max 1 commentary per 8 seconds
    const now = Date.now()
    if (now - state.lastCommentaryAt < RATE_LIMIT_MS) {
      return
    }

    // Must have some context to comment on
    if (state.contextBuffer.length === 0) return

    state.lastCommentaryAt = now

    const prompt = this._buildPrompt(state.contextBuffer)

    this._spawnHaikuCall(prompt)
      .then((result) => {
        if (result?.text) {
          // Check tab is still active before broadcasting
          const currentState = this.tabStates.get(tabId)
          if (currentState?.active) {
            this.broadcast(tabId, { type: 'companion_message', content: result.text })
          }
        }
      })
      .catch((err) => {
        log(`Commentary generation failed: ${(err as Error).message}`)
      })
  }

  // ─── Internal: Prompt Construction ───

  buildPrompt(contextBuffer: ToolCallEntry[]): string {
    return this._buildPrompt(contextBuffer)
  }

  private _buildPrompt(contextBuffer: ToolCallEntry[]): string {
    const toolSummary = contextBuffer.map((entry) => {
      let desc = `- ${entry.toolName}`
      if (entry.partialInput) {
        // Extract meaningful info from partial input
        const trimmed = entry.partialInput.trim().slice(0, 200)
        if (trimmed) desc += `: ${trimmed}`
      }
      return desc
    }).join('\n')

    return [
      'You are a concise companion narrator for a coding assistant.',
      'The main AI agent has been working and just paused between actions.',
      'Based on the recent tool calls below, write 1-2 short sentences explaining what the agent is doing or just did.',
      'Be specific but brief. Do not use quotes or markdown. Speak in present tense.',
      '',
      'Recent tool calls:',
      toolSummary,
      '',
      'Commentary (1-2 sentences only):',
    ].join('\n')
  }

  // ─── Internal: Haiku CLI Spawn ───

  private _spawnHaikuCall(prompt: string): Promise<{ text: string; costUsd: number } | null> {
    return new Promise((resolve) => {
      const args = [
        ...this.entryPoint.prefixArgs,
        '-p',
        '--output-format', 'stream-json',
        '--model', HAIKU_MODEL,
        '--effort', 'low',
        '--max-turns', '1',
      ]

      const child = spawn(this.entryPoint.binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: homedir(),
        env: this._getEnv(),
      })

      let resultText = ''
      let costUsd = 0
      let gotResult = false

      const parser = StreamParser.fromStream(child.stdout!)

      parser.on('event', (raw: any) => {
        if (raw.type === 'result') {
          gotResult = true
          resultText = typeof raw.result === 'string' ? raw.result : ''
          costUsd = typeof raw.total_cost_usd === 'number' ? raw.total_cost_usd : 0
          try { child.stdin?.end() } catch (e) {
            log(`Failed to close stdin: ${(e as Error).message}`)
          }
        }
      })

      parser.on('parse-error', (line: string) => {
        log(`Haiku parse error: ${line.substring(0, 200)}`)
      })

      child.stderr?.setEncoding('utf-8')
      child.stderr?.on('data', (data: string) => {
        log(`Haiku stderr: ${data.trim().substring(0, 300)}`)
      })

      child.on('close', () => {
        child.removeAllListeners()
        child.stdout?.removeAllListeners()
        child.stderr?.removeAllListeners()
        parser.removeAllListeners()

        if (gotResult && resultText) {
          resolve({ text: resultText, costUsd })
        } else {
          log('Haiku call completed without result')
          resolve(null)
        }
      })

      child.on('error', (err) => {
        log(`Haiku spawn error: ${err.message}`)
        child.removeAllListeners()
        child.stdout?.removeAllListeners()
        child.stderr?.removeAllListeners()
        parser.removeAllListeners()
        resolve(null)
      })

      // Send the prompt via stdin (stream-json format)
      const userMessage = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
      })
      child.stdin!.write(userMessage + '\n')

      // Timeout after 15 seconds (shorter than digest — commentary should be fast)
      setTimeout(() => {
        if (!gotResult) {
          log('Haiku commentary call timed out')
          try { child.kill() } catch (e) {
            log(`Failed to kill timed-out process: ${(e as Error).message}`)
          }
        }
      }, HAIKU_TIMEOUT_MS)
    })
  }

  // ─── Internal: Lifecycle ───

  private _stopTracking(tabId: string): void {
    const state = this.tabStates.get(tabId)
    if (state) {
      if (state.timer) clearTimeout(state.timer)
      state.active = false
      state.timer = null
    }
    this.tabStates.delete(tabId)
  }

  private _clearAllTimers(): void {
    for (const [, state] of this.tabStates) {
      if (state.timer) clearTimeout(state.timer)
      state.active = false
      state.timer = null
    }
    this.tabStates.clear()
  }

  // ─── Internal: Settings Persistence ───

  private _loadSettings(): CompanionSettings {
    try {
      if (existsSync(SETTINGS_PATH)) {
        const raw = readFileSync(SETTINGS_PATH, 'utf-8')
        const parsed = JSON.parse(raw)
        if (typeof parsed.enabled === 'boolean') {
          return { enabled: parsed.enabled }
        }
      }
    } catch (err) {
      log(`Failed to load settings: ${(err as Error).message}`)
    }
    return { enabled: false }
  }

  private _saveSettings(settings: CompanionSettings): void {
    try {
      const dir = join(homedir(), '.clui')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
    } catch (err) {
      log(`Failed to save settings: ${(err as Error).message}`)
    }
  }

  private _getEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env }
    delete env.CLAUDECODE
    return env
  }
}
