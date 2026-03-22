import { appendFile, appendFileSync, existsSync, statSync, renameSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const LOG_FILE = join(homedir(), '.clui-debug.log')
const FLUSH_INTERVAL_MS = 500
const MAX_BUFFER_SIZE = 64

/** Maximum size of a single log file before rotation (5 MB) */
export const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024

/** Number of rotated log files to keep */
export const MAX_LOG_FILES = 3

export const LogLevel = {
  INFO: 'info' as const,
  DEBUG: 'debug' as const,
}

type LogLevelValue = 'info' | 'debug'

const DEBUG_MODE = process.env.CLUI_DEBUG === '1'

let buffer: string[] = []
let timer: ReturnType<typeof setInterval> | null = null
/** All chunks handed to async appendFile not yet confirmed written */
const inFlight = new Map<number, string>()
let nextChunkId = 1

function flush(): void {
  if (buffer.length === 0) return
  const chunk = buffer.join('')
  buffer = []
  const chunkId = nextChunkId++
  inFlight.set(chunkId, chunk)
  appendFile(LOG_FILE, chunk, () => { inFlight.delete(chunkId) })
}

function ensureTimer(): void {
  if (timer) return
  timer = setInterval(flush, FLUSH_INTERVAL_MS)
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    timer.unref()
  }
}

export function log(tag: string, msg: string, level?: LogLevelValue): void {
  const effectiveLevel = level ?? 'info'

  // Skip debug messages unless CLUI_DEBUG=1
  if (effectiveLevel === 'debug' && !DEBUG_MODE) return

  buffer.push(`[${new Date().toISOString()}] [${tag}] ${msg}\n`)
  if (buffer.length >= MAX_BUFFER_SIZE) flush()
  ensureTimer()
}

/**
 * Synchronously drain all pending logs. Call on shutdown to guarantee
 * every buffered or in-flight line is persisted before the process exits.
 */
export function flushLogs(): void {
  if (timer) { clearInterval(timer); timer = null }
  // Re-write all in-flight chunks synchronously (async writes may not have landed)
  const pendingInflight = Array.from(inFlight.values()).join('')
  const pending = pendingInflight + buffer.join('')
  inFlight.clear()
  buffer = []
  if (pending) {
    try { appendFileSync(LOG_FILE, pending) } catch {}
  }
}

/**
 * Rotate log files if the current log exceeds MAX_LOG_SIZE_BYTES.
 * Keeps up to MAX_LOG_FILES rotated copies: .log.1, .log.2, etc.
 */
export function rotateLogsIfNeeded(): void {
  try {
    if (!existsSync(LOG_FILE)) return
    const stat = statSync(LOG_FILE)
    if (stat.size < MAX_LOG_SIZE_BYTES) return

    // Delete oldest file beyond MAX_LOG_FILES
    const oldest = `${LOG_FILE}.${MAX_LOG_FILES - 1}`
    if (existsSync(oldest)) {
      try { unlinkSync(oldest) } catch {}
    }

    // Shift existing rotated files: .log.N-1 → .log.N
    for (let i = MAX_LOG_FILES - 2; i >= 1; i--) {
      const from = `${LOG_FILE}.${i}`
      const to = `${LOG_FILE}.${i + 1}`
      if (existsSync(from)) {
        try { renameSync(from, to) } catch {}
      }
    }

    // Rotate current → .log.1
    try { renameSync(LOG_FILE, `${LOG_FILE}.1`) } catch {}
  } catch {}
}

/** Returns the path to the primary log file. */
export function getLogFilePath(): string {
  return LOG_FILE
}

export { LOG_FILE }
