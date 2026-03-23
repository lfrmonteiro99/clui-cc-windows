import type { StashEntry } from '../../shared/sandbox-types'
import { gitExec } from './git-exec'
import { log as _log } from '../logger'

function log(msg: string): void {
  _log('StashManager', msg)
}

export class StashManager {
  /**
   * List all stash entries with metadata.
   * Parses git stash list output into structured StashEntry objects.
   */
  async list(cwd: string): Promise<StashEntry[]> {
    log(`listing stashes in ${cwd}`)

    let raw: string
    try {
      raw = await gitExec(['stash', 'list', '--format=%H%n%s%n%at%n%gd'], cwd)
    } catch {
      return []
    }

    const lines = raw.split('\n').filter((l) => l.length > 0)
    const entries: StashEntry[] = []

    // Each stash produces 4 lines: hash, subject, timestamp, reflog selector
    for (let i = 0; i + 3 < lines.length; i += 4) {
      const _hash = lines[i]
      const message = lines[i + 1]
      const timestamp = parseInt(lines[i + 2], 10)
      const ref = lines[i + 3] // e.g. "stash@{0}"

      // Extract index from ref
      const indexMatch = ref.match(/\{(\d+)\}/)
      const index = indexMatch ? parseInt(indexMatch[1], 10) : entries.length

      // Extract branch from subject if available
      // Format: "On <branch>: <message>" or "WIP on <branch>: ..."
      const branchMatch = message.match(/(?:On|WIP on) ([^:]+):/)
      const branch = branchMatch ? branchMatch[1] : ''

      // Get file count for this stash
      let fileCount = 0
      try {
        const nameOnly = await gitExec(['stash', 'show', '--name-only', ref], cwd)
        fileCount = nameOnly.split('\n').filter((l) => l.length > 0).length
      } catch {
        // Stash may be empty or corrupt
      }

      entries.push({
        index,
        ref,
        message,
        timestamp,
        branch,
        fileCount,
      })
    }

    return entries
  }

  /**
   * Get the diff for a specific stash entry, optionally filtered to a single file.
   */
  async getDiff(cwd: string, index: number, file?: string): Promise<string> {
    log(`getting stash diff: stash@{${index}} in ${cwd}`)
    const ref = `stash@{${index}}`
    const args = ['stash', 'show', '-p', ref]
    if (file) {
      args.push('--', file)
    }
    return gitExec(args, cwd)
  }
}
