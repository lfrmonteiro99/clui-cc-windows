import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import { StreamParser } from '../stream-parser'
import { normalize } from './event-normalizer'
import { log as _log } from '../logger'
import { resolveClaudeEntryPoint, getLoginShellPath, ensureBinDirInPath } from '../platform'
import { spawnInWsl } from '../wsl/wsl-spawner'
import { CircularBuffer } from '../circular-buffer'
import { buildPromptArgs, cleanupPromptFile } from './prompt-file'
import type { ClaudeEntryPoint } from '../platform'
import type { ClaudeEvent, NormalizedEvent, RunOptions, EnrichedError } from '../../shared/types'

const MAX_RING_LINES = 100
const DEBUG = process.env.CLUI_DEBUG === '1'

// Appended to Claude's default system prompt so it knows it's running inside CLUI.
// Uses --append-system-prompt (additive) not --system-prompt (replacement).
const CLUI_SYSTEM_HINT = [
  'You are inside CLUI, a desktop GUI that renders full markdown. Use rich formatting:',
  'tables, links [label](url), code blocks, headers, bold. Images via ![alt](real-url-only).',
  '',
  'BUG REPORTS: Read context memory (above) first → git log -10 → git show changed files → trace root cause → THEN fix. Never guess.',
].join('\n')

// Tools auto-approved via --allowedTools (never trigger the permission card).
// Includes routine internal agent mechanics (Agent, Task, TaskOutput, TodoWrite,
// Notebook) — prompting for these would make UX terrible without adding meaningful
// safety. This is a deliberate CLUI policy choice, not native Claude parity.
// If runtime evidence shows any of these create real user-facing approval moments,
// they should be moved to the hook matcher in permission-server.ts instead.
const SAFE_TOOLS = [
  'Read', 'Glob', 'Grep', 'LS',
  'TodoRead', 'TodoWrite',
  'Agent', 'Task', 'TaskOutput',
  'Notebook',
  'WebSearch', 'WebFetch',
]

// All tools to pre-approve when NO hook server is available (fallback path).
// Includes safe + dangerous tools so nothing is silently denied.
const DEFAULT_ALLOWED_TOOLS = [
  'Bash', 'Edit', 'Write', 'MultiEdit',
  ...SAFE_TOOLS,
]

function log(msg: string): void {
  _log('RunManager', msg)
}

export interface RunHandle {
  runId: string
  sessionId: string | null
  process: ChildProcess
  pid: number | null
  startedAt: number
  /** Ring buffer of last N stderr lines */
  stderrTail: CircularBuffer<string>
  /** Ring buffer of last N stdout lines */
  stdoutTail: CircularBuffer<string>
  /** Count of tool calls seen during this run */
  toolCallCount: number
  /** Whether any permission_request event was seen during this run */
  sawPermissionRequest: boolean
  /** Permission denials from result event */
  permissionDenials: Array<{ tool_name: string; tool_use_id: string }>
  /** Path to temp system prompt file (null if using inline arg or WSL) */
  promptFilePath: string | null
}

/**
 * RunManager: spawns one `claude -p` process per run, parses NDJSON,
 * emits normalized events, handles cancel, and keeps diagnostic ring buffers.
 *
 * Events emitted:
 *  - 'normalized' (runId, NormalizedEvent)
 *  - 'raw' (runId, ClaudeEvent)  — for logging/debugging
 *  - 'exit' (runId, code, signal, sessionId)
 *  - 'error' (runId, Error)
 */
export class RunManager extends EventEmitter {
  private activeRuns = new Map<string, RunHandle>()
  /** Holds recently-finished runs so diagnostics survive past process exit */
  private _finishedRuns = new Map<string, RunHandle>()
  private entryPoint: ClaudeEntryPoint
  private _loginShellPath = ''

  constructor() {
    super()
    this.entryPoint = resolveClaudeEntryPoint()
    log(`Claude entry point: binary=${this.entryPoint.binary} prefixArgs=[${this.entryPoint.prefixArgs.join(', ')}]`)
  }

  private _getEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env }
    delete env.CLAUDECODE

    if (!this._loginShellPath) {
      this._loginShellPath = getLoginShellPath()
    }
    if (this._loginShellPath) {
      env.PATH = this._loginShellPath
    }

    ensureBinDirInPath(this.entryPoint.binary, env)

    return env
  }

  startRun(requestId: string, options: RunOptions): RunHandle {
    const cwd = options.projectPath === '~' ? homedir() : options.projectPath

    const args: string[] = [
      ...this.entryPoint.prefixArgs,
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode', 'default',
    ]

    if (options.sessionId) {
      args.push('--resume', options.sessionId)
    }
    if (options.model) {
      args.push('--model', options.model)
    }
    if (options.addDirs && options.addDirs.length > 0) {
      for (const dir of options.addDirs) {
        args.push('--add-dir', dir)
      }
    }

    if (options.hookSettingsPath) {
      // CLUI-scoped hook settings: the PreToolUse HTTP hook handles permissions
      // for dangerous tools (Bash, Edit, Write, MultiEdit).
      // Auto-approve safe tools so they don't trigger the permission card.
      args.push('--settings', options.hookSettingsPath)
      const safeAllowed = [
        ...SAFE_TOOLS,
        ...(options.allowedTools || []),
      ]
      args.push('--allowedTools', safeAllowed.join(','))
    } else {
      // Fallback: no hook server available.
      // Pre-approve common tools so they run without being silently denied.
      const allAllowed = [
        ...DEFAULT_ALLOWED_TOOLS,
        ...(options.allowedTools || []),
      ]
      args.push('--allowedTools', allAllowed.join(','))
    }
    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns))
    }
    if (options.maxBudgetUsd) {
      args.push('--max-budget-usd', String(options.maxBudgetUsd))
    }
    // Combine CLUI hint with any existing system prompt (memory packet, agent context).
    // Delivered via temp file (--append-system-prompt-file) to avoid CLI arg length limits.
    // WSL runs use inline --append-system-prompt to avoid path translation issues.
    const combinedSystemPrompt = [options.systemPrompt, CLUI_SYSTEM_HINT].filter(Boolean).join('\n\n')
    const isWsl = options.runtime === 'wsl' && !!options.wslDistro
    const promptResult = buildPromptArgs(requestId, combinedSystemPrompt, isWsl)
    args.push(...promptResult.args)

    if (DEBUG) {
      log(`Starting run ${requestId}: ${this.entryPoint.binary} ${args.join(' ')}`)
      log(`Prompt: ${options.prompt.substring(0, 200)}`)
    } else {
      log(`Starting run ${requestId}`)
    }

    // Route through WSL spawner when runtime is 'wsl' with a distro specified
    const child: ChildProcess = (options.runtime === 'wsl' && options.wslDistro)
      ? spawnInWsl({
          distro: options.wslDistro,
          args,
          cwd,
          env: this._getEnv() as Record<string, string>,
          hookSettingsPath: options.hookSettingsPath,
        })
      : spawn(this.entryPoint.binary, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd,
          env: this._getEnv(),
        })

    log(`Spawned PID: ${child.pid}`)

    const handle: RunHandle = {
      runId: requestId,
      sessionId: options.sessionId || null,
      process: child,
      pid: child.pid || null,
      startedAt: Date.now(),
      stderrTail: new CircularBuffer<string>(MAX_RING_LINES),
      stdoutTail: new CircularBuffer<string>(MAX_RING_LINES),
      toolCallCount: 0,
      sawPermissionRequest: false,
      permissionDenials: [],
      promptFilePath: promptResult.filePath,
    }

    // ─── stdout → NDJSON parser → normalizer → events ───
    const parser = StreamParser.fromStream(child.stdout!)

    parser.on('event', (raw: ClaudeEvent) => {
      // Track session ID
      if (raw.type === 'system' && 'subtype' in raw && raw.subtype === 'init') {
        handle.sessionId = (raw as any).session_id
      }

      // Track permission_request events
      if (raw.type === 'permission_request' || (raw.type === 'system' && 'subtype' in raw && (raw as any).subtype === 'permission_request')) {
        handle.sawPermissionRequest = true
        log(`Permission request seen [${requestId}]`)
      }

      // Extract permission_denials from result event
      if (raw.type === 'result') {
        const denials = (raw as any).permission_denials
        if (Array.isArray(denials) && denials.length > 0) {
          handle.permissionDenials = denials.map((d: any) => ({
            tool_name: d.tool_name || '',
            tool_use_id: d.tool_use_id || '',
          }))
          log(`Permission denials [${requestId}]: ${JSON.stringify(handle.permissionDenials)}`)
        }
      }

      // Ring buffer stdout lines (raw JSON for diagnostics)
      handle.stdoutTail.push(JSON.stringify(raw).substring(0, 300))

      // Emit raw event for debugging
      this.emit('raw', requestId, raw)

      // Normalize and emit canonical events
      const normalized = normalize(raw)
      for (const evt of normalized) {
        if (evt.type === 'tool_call') handle.toolCallCount++
        this.emit('normalized', requestId, evt)
      }

      // Close stdin after result event — with stream-json input the process
      // stays alive waiting for more input; closing stdin triggers clean exit.
      if (raw.type === 'result') {
        log(`Run complete [${requestId}]: sawPermissionRequest=${handle.sawPermissionRequest}, denials=${handle.permissionDenials.length}`)
        try { child.stdin?.end() } catch {}
      }
    })

    parser.on('parse-error', (line: string) => {
      log(`Parse error [${requestId}]: ${line.substring(0, 200)}`)
      handle.stderrTail.push(`[parse-error] ${line.substring(0, 200)}`)
    })

    // ─── stderr ring buffer ───
    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (data: string) => {
      const lines = data.split('\n').filter((l: string) => l.trim())
      for (const line of lines) {
        handle.stderrTail.push(line)
      }
      log(`Stderr [${requestId}]: ${data.trim().substring(0, 500)}`)
    })

    // ─── Process lifecycle ───
    // Snapshot diagnostics BEFORE deleting the handle so callers can still read them.
    child.on('close', (code, signal) => {
      log(`Process closed [${requestId}]: code=${code} signal=${signal}`)
      // Remove all listeners from the child process to allow GC
      child.removeAllListeners()
      child.stdout?.removeAllListeners()
      child.stderr?.removeAllListeners()
      parser.removeAllListeners()
      // Null out process reference so GC can reclaim ChildProcess sooner
      handle.process = null as unknown as ChildProcess
      // Move handle to finished map so getEnrichedError still works after exit
      this._finishedRuns.set(requestId, handle)
      this.activeRuns.delete(requestId)
      this.emit('exit', requestId, code, signal, handle.sessionId)
      cleanupPromptFile(handle.promptFilePath)
      // Clean up finished run after a short delay (gives callers time to read diagnostics)
      setTimeout(() => this._finishedRuns.delete(requestId), 5000)
    })

    child.on('error', (err) => {
      log(`Process error [${requestId}]: ${err.message}`)
      // Remove all listeners from the child process to allow GC
      child.removeAllListeners()
      child.stdout?.removeAllListeners()
      child.stderr?.removeAllListeners()
      parser.removeAllListeners()
      handle.process = null as unknown as ChildProcess
      this._finishedRuns.set(requestId, handle)
      this.activeRuns.delete(requestId)
      this.emit('error', requestId, err)
      cleanupPromptFile(handle.promptFilePath)
      setTimeout(() => this._finishedRuns.delete(requestId), 5000)
    })

    // ─── Write prompt to stdin (stream-json format, keep open) ───
    // Using --input-format stream-json for bidirectional communication.
    // Stdin stays open so follow-up messages can be sent.
    const userMessage = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: options.prompt }],
      },
    })
    child.stdin!.write(userMessage + '\n')

    this.activeRuns.set(requestId, handle)
    return handle
  }

  /**
   * Write a message to a running process's stdin (for follow-up prompts, etc.)
   */
  writeToStdin(requestId: string, message: object): boolean {
    const handle = this.activeRuns.get(requestId)
    if (!handle) return false
    if (!handle.process.stdin || handle.process.stdin.destroyed) return false

    const json = JSON.stringify(message)
    log(`Writing to stdin [${requestId}]: ${json.substring(0, 200)}`)
    handle.process.stdin.write(json + '\n')
    return true
  }

  /**
   * Cancel a running process: close stdin, then SIGINT, then SIGKILL after 5s.
   *
   * Closing stdin first is the most reliable shutdown signal for WSL processes
   * (where SIGINT may not propagate through wsl.exe), but it's also a clean
   * shutdown pattern for native processes — the CLI exits when stdin closes.
   */
  cancel(requestId: string): boolean {
    const handle = this.activeRuns.get(requestId)
    if (!handle) return false

    log(`Cancelling run ${requestId}`)

    // Close stdin first — propagates reliably through wsl.exe
    if (handle.process.stdin && !handle.process.stdin.destroyed) {
      handle.process.stdin.end()
    }

    // Then SIGINT as backup
    handle.process.kill('SIGINT')

    // Fallback: SIGKILL if process hasn't exited after 5s.
    // Only check exitCode — process.killed is set true by the SIGINT call above,
    // so checking !killed would prevent the fallback from ever firing.
    setTimeout(() => {
      if (handle.process.exitCode === null) {
        log(`Force killing run ${requestId} (SIGINT did not terminate)`)
        handle.process.kill('SIGKILL')
      }
    }, 5000)

    return true
  }

  /**
   * Get an enriched error object for a failed run.
   */
  getEnrichedError(requestId: string, exitCode: number | null): EnrichedError {
    const handle = this.activeRuns.get(requestId) || this._finishedRuns.get(requestId)
    return {
      message: `Run failed with exit code ${exitCode}`,
      stderrTail: handle?.stderrTail.toArray().slice(-20) || [],
      stdoutTail: handle?.stdoutTail.toArray().slice(-20) || [],
      exitCode,
      elapsedMs: handle ? Date.now() - handle.startedAt : 0,
      toolCallCount: handle?.toolCallCount || 0,
      sawPermissionRequest: handle?.sawPermissionRequest || false,
      permissionDenials: handle?.permissionDenials || [],
    }
  }

  isRunning(requestId: string): boolean {
    return this.activeRuns.has(requestId)
  }

  getHandle(requestId: string): RunHandle | undefined {
    return this.activeRuns.get(requestId)
  }

  getActiveRunIds(): string[] {
    return Array.from(this.activeRuns.keys())
  }

}
