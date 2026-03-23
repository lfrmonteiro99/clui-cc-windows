import { execFile } from 'child_process'
import { access, constants } from 'fs/promises'
import { join } from 'path'
import { log as _log } from '../logger'

function log(msg: string): void {
  _log('GitExec', msg)
}

const DEFAULT_TIMEOUT = 15_000
const MAX_BUFFER = 2 * 1024 * 1024 // 2 MB

export class GitExecError extends Error {
  command: string
  args: string[]
  stderr: string
  exitCode: number | null

  constructor(command: string, args: string[], stderr: string, exitCode: number | null) {
    super(`git ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim()}`)
    this.name = 'GitExecError'
    this.command = command
    this.args = args
    this.stderr = stderr
    this.exitCode = exitCode
  }
}

/**
 * Execute a git command safely using execFile (no shell).
 * Returns stdout on success, throws GitExecError on failure.
 */
export function gitExec(args: string[], cwd: string, timeout?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    log(`exec: git ${args.join(' ')} in ${cwd}`)
    execFile(
      'git',
      args,
      { cwd, maxBuffer: MAX_BUFFER, timeout: timeout ?? DEFAULT_TIMEOUT },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException & { code?: number | string }).code
          const exitCode = typeof code === 'number' ? code : (error as { status?: number }).status ?? null
          reject(new GitExecError('git', args, stderr ?? error.message, exitCode))
        } else {
          resolve(stdout)
        }
      },
    )
  })
}

/**
 * Check whether `cwd` is inside a git repository.
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await gitExec(['rev-parse', '--git-dir'], cwd)
    return true
  } catch {
    return false
  }
}

/**
 * Throw if the repo is in the middle of a merge, rebase, or cherry-pick.
 * These states make branch operations unsafe.
 */
export async function guardRepoState(cwd: string): Promise<void> {
  const gitDir = (await gitExec(['rev-parse', '--git-dir'], cwd)).trim()
  const base = join(cwd, gitDir)

  const checks: Array<{ file: string; label: string }> = [
    { file: join(base, 'MERGE_HEAD'), label: 'merge' },
    { file: join(base, 'rebase-merge'), label: 'rebase' },
    { file: join(base, 'rebase-apply'), label: 'rebase' },
    { file: join(base, 'CHERRY_PICK_HEAD'), label: 'cherry-pick' },
  ]

  for (const { file, label } of checks) {
    try {
      await access(file, constants.F_OK)
      throw new Error(`Repository is in the middle of a ${label}. Resolve it before using sandbox mode.`)
    } catch (err) {
      // If the error is our own (label-based), re-throw it
      if (err instanceof Error && err.message.includes('Repository is in the middle')) {
        throw err
      }
      // Otherwise file doesn't exist, which is the expected/safe state
    }
  }
}
