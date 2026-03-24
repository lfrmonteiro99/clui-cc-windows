import { spawn } from 'child_process'
import { log as _log } from './logger'
import { maskSensitiveFields } from './hooks/permission-server'
import type { ShellExecRequest, ShellOutput } from '../shared/types'

const TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 50 * 1024 // 50 KB

function log(msg: string): void {
  _log('ShellExecutor', msg)
}

/**
 * Returns the platform-appropriate shell binary and flag.
 * Exported for testing.
 */
export function getShellForPlatform(platform: string = process.platform): { shell: string; flag: string } {
  if (platform === 'win32') {
    return { shell: 'cmd.exe', flag: '/c' }
  }
  return { shell: '/bin/sh', flag: '-c' }
}

/**
 * Truncate output to MAX_OUTPUT_BYTES, appending a notice if truncated.
 */
function capOutput(data: string): { text: string; truncated: boolean } {
  if (Buffer.byteLength(data, 'utf-8') <= MAX_OUTPUT_BYTES) {
    return { text: data, truncated: false }
  }
  // Truncate by bytes, then find last valid character boundary
  const buf = Buffer.from(data, 'utf-8')
  const truncated = buf.subarray(0, MAX_OUTPUT_BYTES).toString('utf-8')
  return {
    text: truncated + '\n\n[Output truncated at 50 KB]',
    truncated: true,
  }
}

/**
 * Execute a shell command in the given working directory.
 * Returns captured stdout/stderr with security masking applied.
 */
export function executeShell(request: ShellExecRequest): Promise<ShellOutput> {
  const { command, cwd } = request

  if (!command || !command.trim()) {
    return Promise.resolve({
      stdout: '',
      stderr: 'Empty command — nothing to execute.',
      exitCode: -1,
      truncated: false,
      command: '',
      durationMs: 0,
    })
  }

  const { shell, flag } = getShellForPlatform()
  const startTime = Date.now()

  log(`Executing: ${command.substring(0, 200)} in ${cwd}`)

  return new Promise<ShellOutput>((resolve) => {
    // Strip CLAUDECODE from env (security convention)
    const env = { ...process.env }
    delete env.CLAUDECODE

    const child = spawn(shell, [flag, command], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (exitCode: number) => {
      if (settled) return
      settled = true

      const durationMs = Date.now() - startTime
      const cappedStdout = capOutput(stdout)
      const cappedStderr = capOutput(stderr)

      // Mask sensitive fields in output (defense-in-depth)
      const maskedStdout = maskSensitiveOutput(cappedStdout.text)
      const maskedStderr = maskSensitiveOutput(cappedStderr.text)

      log(`Completed: exitCode=${exitCode} duration=${durationMs}ms stdout=${stdout.length}b stderr=${stderr.length}b`)

      resolve({
        stdout: maskedStdout,
        stderr: maskedStderr,
        exitCode,
        truncated: cappedStdout.truncated || cappedStderr.truncated,
        command,
        durationMs,
      })
    }

    // Timeout enforcement
    const timer = setTimeout(() => {
      if (!settled) {
        log(`Timed out after ${TIMEOUT_MS}ms: ${command.substring(0, 100)}`)
        child.kill('SIGKILL')
        settled = true
        resolve({
          stdout: capOutput(stdout).text,
          stderr: `Command timed out after ${TIMEOUT_MS / 1000}s`,
          exitCode: -1,
          truncated: false,
          command,
          durationMs: Date.now() - startTime,
        })
      }
    }, TIMEOUT_MS)

    child.stdout!.setEncoding('utf-8')
    child.stderr!.setEncoding('utf-8')

    child.stdout!.on('data', (data: string) => {
      stdout += data
    })

    child.stderr!.on('data', (data: string) => {
      stderr += data
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      finish(code ?? -1)
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      stderr += err.message
      finish(-1)
    })
  })
}

/**
 * Apply basic sensitive-field masking to shell output strings.
 * This catches environment variable dumps that might contain secrets.
 */
function maskSensitiveOutput(output: string): string {
  // Mask common secret patterns in env dumps / config output
  return output.replace(
    /((?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH)[=:]\s*)([\S]+)/gi,
    '$1***'
  )
}
