/**
 * SessionDigestManager — generates cross-session context digests via Haiku CLI.
 *
 * When a tab completes a task (opt-in), spawns a background Haiku CLI call to
 * produce a 3-5 bullet summary. Stored digests are injected into other tabs'
 * system prompts for cross-session awareness.
 */
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { StreamParser } from '../stream-parser'
import { resolveClaudeEntryPoint } from '../platform'
import { log as _log } from '../logger'
import type { ClaudeEntryPoint } from '../platform'
import type { Message, SessionDigest, SessionDigestSettings, SessionDigestStats } from '../../shared/types'

const MAX_STORED_DIGESTS = 50
const MAX_DIGESTS_PER_PROJECT = 5
const MAX_EXTRACTED_MESSAGES = 5
const MAX_CONTENT_LENGTH = 800
const DIGEST_MODEL = 'claude-haiku-4-5-20251001'
const SETTINGS_KEY = 'sessionDigest'

function log(msg: string): void {
  _log('SessionDigest', msg)
}

type BroadcastFn = (tabId: string, event: unknown) => void

interface DigestStorageFile {
  version: 1
  digests: SessionDigest[]
  settings: SessionDigestSettings
}

export class SessionDigestManager {
  private storagePath: string
  private entryPoint: ClaudeEntryPoint
  private broadcast: BroadcastFn

  constructor(broadcast: BroadcastFn, entryPoint?: ClaudeEntryPoint) {
    this.broadcast = broadcast
    this.entryPoint = entryPoint ?? resolveClaudeEntryPoint()
    this.storagePath = join(homedir(), '.clui', 'session-digests.json')
  }

  // ─── Settings ───

  getSettings(): SessionDigestSettings {
    const state = this._readStorage()
    return { ...state.settings }
  }

  setSettings(settings: SessionDigestSettings): void {
    const state = this._readStorage()
    state.settings = { ...settings }
    this._writeStorage(state)
    log(`Settings updated: enabled=${settings.enabled}`)
  }

  isEnabled(): boolean {
    return this._readStorage().settings.enabled
  }

  // ─── Digest Generation ───

  async generateDigest(
    tabId: string,
    tabTitle: string,
    projectPath: string,
    messages: Message[],
  ): Promise<SessionDigest | null> {
    if (!this.isEnabled()) return null

    try {
      const extracted = this._extractMessages(messages)
      if (!extracted.trim()) {
        log('No meaningful messages to summarize, skipping digest')
        return null
      }

      const prompt = [
        'Summarize this coding session\'s work in 3-5 concise bullet points. Include:',
        '- What was done (actions taken)',
        '- Which files were modified',
        '- Key decisions or findings',
        '',
        'Session content:',
        extracted,
      ].join('\n')

      const result = await this._spawnHaikuCall(prompt, projectPath)
      if (!result) return null

      const filesModified = this._extractFilesFromMessages(messages)

      const digest: SessionDigest = {
        id: crypto.randomUUID(),
        tabId,
        tabTitle: tabTitle || 'Untitled',
        projectPath,
        digest: result.text,
        filesModified,
        generatedAt: Date.now(),
        costUsd: result.costUsd,
      }

      this._storeDigest(digest)
      log(`Digest generated for tab ${tabId.substring(0, 8)}: ${result.text.substring(0, 100)}...`)
      return digest
    } catch (err) {
      log(`Digest generation failed: ${(err as Error).message}`)
      return null
    }
  }

  // ─── Query ───

  getDigestsForProject(projectPath: string): SessionDigest[] {
    const state = this._readStorage()
    return state.digests
      .filter((d) => d.projectPath === projectPath)
      .sort((a, b) => b.generatedAt - a.generatedAt)
      .slice(0, MAX_DIGESTS_PER_PROJECT)
  }

  buildContextInjection(projectPath: string, excludeTabId: string): string {
    const digests = this.getDigestsForProject(projectPath)
      .filter((d) => d.tabId !== excludeTabId)

    if (digests.length === 0) return ''

    const lines = ['Cross-session context (recent work by other tabs in this project):']
    for (const d of digests) {
      const age = this._formatAge(d.generatedAt)
      lines.push(`\n[${d.tabTitle}] (${age} ago):`)
      lines.push(d.digest)
      if (d.filesModified.length > 0) {
        lines.push(`Files: ${d.filesModified.slice(0, 10).join(', ')}`)
      }
    }

    return lines.join('\n')
  }

  getStats(): SessionDigestStats {
    const state = this._readStorage()
    const now = Date.now()
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const monthStartMs = monthStart.getTime()

    const monthlyDigests = state.digests.filter((d) => d.generatedAt >= monthStartMs)

    return {
      totalDigests: state.digests.length,
      totalCostUsd: state.digests.reduce((sum, d) => sum + d.costUsd, 0),
      monthlyDigests: monthlyDigests.length,
      monthlyCostUsd: monthlyDigests.reduce((sum, d) => sum + d.costUsd, 0),
    }
  }

  // ─── Internal: CLI Spawn ───

  private _spawnHaikuCall(
    prompt: string,
    cwd: string,
  ): Promise<{ text: string; costUsd: number } | null> {
    return new Promise((resolve) => {
      const args = [
        ...this.entryPoint.prefixArgs,
        '-p',
        '--output-format', 'stream-json',
        '--model', DIGEST_MODEL,
        '--effort', 'low',
        '--max-turns', '1',
      ]

      const child = spawn(this.entryPoint.binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: cwd === '~' ? homedir() : cwd,
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

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!gotResult) {
          log('Haiku call timed out after 30s')
          try { child.kill('SIGTERM') } catch (e) {
            log(`Failed to kill timed-out process: ${(e as Error).message}`)
          }
        }
      }, 30_000)
    })
  }

  // ─── Internal: Message Extraction ───

  _extractMessages(messages: Message[]): string {
    // Get the last N assistant + tool messages for context
    const relevant = messages
      .filter((m) => m.role === 'assistant' || m.role === 'tool')
      .slice(-MAX_EXTRACTED_MESSAGES)

    const parts: string[] = []
    for (const msg of relevant) {
      const role = msg.role === 'assistant' ? 'Assistant' : `Tool (${msg.toolName || 'unknown'})`
      const content = msg.content.substring(0, MAX_CONTENT_LENGTH)
      parts.push(`[${role}]: ${content}`)
    }

    return parts.join('\n\n')
  }

  private _extractFilesFromMessages(messages: Message[]): string[] {
    const files = new Set<string>()
    const filePatterns = [
      /(?:Edit|Write|MultiEdit|Read)\s+(?:file\s+)?['"]?([^\s'"]+)/gi,
      /(?:modified|created|edited|wrote|read)\s+['"]?([^\s'"]+\.[a-z]+)/gi,
    ]

    for (const msg of messages) {
      if (msg.role !== 'tool') continue
      // Tool name gives us direct info about file operations
      if (msg.toolName === 'Edit' || msg.toolName === 'Write' || msg.toolName === 'MultiEdit') {
        try {
          if (msg.toolInput) {
            const input = JSON.parse(msg.toolInput)
            if (input.file_path) files.add(input.file_path)
            if (input.path) files.add(input.path)
          }
        } catch {
          // toolInput might not be valid JSON, try regex
          for (const pattern of filePatterns) {
            const matches = msg.content.matchAll(pattern)
            for (const match of matches) {
              if (match[1]) files.add(match[1])
            }
          }
        }
      }
    }

    return Array.from(files).slice(0, 20)
  }

  // ─── Internal: Storage ───

  _storeDigest(digest: SessionDigest): void {
    const state = this._readStorage()
    state.digests.unshift(digest)
    // Purge oldest if over limit
    if (state.digests.length > MAX_STORED_DIGESTS) {
      state.digests = state.digests.slice(0, MAX_STORED_DIGESTS)
    }
    this._writeStorage(state)
  }

  _readStorage(): DigestStorageFile {
    try {
      if (!existsSync(this.storagePath)) {
        return this._defaultStorage()
      }
      const raw = readFileSync(this.storagePath, 'utf-8')
      const parsed = JSON.parse(raw)
      return {
        version: 1,
        digests: Array.isArray(parsed?.digests) ? parsed.digests : [],
        settings: {
          enabled: typeof parsed?.settings?.enabled === 'boolean' ? parsed.settings.enabled : false,
        },
      }
    } catch (err) {
      log(`Failed to read storage: ${(err as Error).message}`)
      return this._defaultStorage()
    }
  }

  private _writeStorage(state: DigestStorageFile): void {
    const dir = dirname(this.storagePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(this.storagePath, JSON.stringify(state, null, 2), 'utf-8')
  }

  private _defaultStorage(): DigestStorageFile {
    return {
      version: 1,
      digests: [],
      settings: { enabled: false },
    }
  }

  private _getEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env }
    delete env.CLAUDECODE
    return env
  }

  private _formatAge(timestamp: number): string {
    const diffMs = Date.now() - timestamp
    const mins = Math.floor(diffMs / 60_000)
    if (mins < 60) return `${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    return `${days}d`
  }
}
