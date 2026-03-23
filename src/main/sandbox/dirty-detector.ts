import type { DirtyState } from '../../shared/sandbox-types'
import { gitExec } from './git-exec'
import { log as _log } from '../logger'

function log(msg: string): void {
  _log('DirtyDetector', msg)
}

export class DirtyDetector {
  /**
   * Check the working directory for uncommitted changes, untracked files, and stashes.
   */
  async check(cwd: string): Promise<DirtyState> {
    log(`checking dirty state in ${cwd}`)

    const porcelain = await gitExec(['status', '--porcelain'], cwd)
    const lines = porcelain.split('\n').filter((l) => l.length > 0)

    const untracked: string[] = []
    const unstaged: string[] = []

    for (const line of lines) {
      const xy = line.slice(0, 2)
      const path = line.slice(3)
      if (xy === '??') {
        untracked.push(path)
      } else {
        unstaged.push(path)
      }
    }

    // Count stashes
    let stashCount = 0
    try {
      const stashList = await gitExec(['stash', 'list'], cwd)
      stashCount = stashList.split('\n').filter((l) => l.length > 0).length
    } catch {
      // No stashes or stash not supported
    }

    const isDirty = untracked.length > 0 || unstaged.length > 0
    const parts: string[] = []
    if (unstaged.length > 0) parts.push(`${unstaged.length} modified`)
    if (untracked.length > 0) parts.push(`${untracked.length} untracked`)
    if (stashCount > 0) parts.push(`${stashCount} stash(es)`)
    const summary = parts.length > 0 ? parts.join(', ') : 'clean'

    return { isDirty, untracked, unstaged, stashCount, summary }
  }

  /**
   * Stash all changes (including untracked files) with a descriptive message.
   * Returns the stash reference (e.g. "stash@{0}").
   */
  async autoStash(cwd: string, message: string): Promise<string> {
    log(`auto-stashing in ${cwd}: ${message}`)
    await gitExec(['stash', 'push', '-m', message], cwd)
    return 'stash@{0}'
  }
}
