import type { DiffSummary, DiffFileStat, MergeResult } from '../../shared/sandbox-types'
import { gitExec } from './git-exec'
import { log as _log } from '../logger'

function log(msg: string): void {
  _log('GitDiffEngine', msg)
}

const MAX_RAW_DIFF_BYTES = 100 * 1024 // 100 KB

export class GitDiffEngine {
  /**
   * Generate a diff summary between the worktree HEAD and the base branch.
   */
  async getDiff(worktreePath: string, baseBranch: string): Promise<DiffSummary> {
    log(`getDiff: ${baseBranch}...HEAD in ${worktreePath}`)

    // Get numeric stats (insertions/deletions per file)
    const numstatRaw = await gitExec(
      ['diff', '--numstat', `${baseBranch}...HEAD`],
      worktreePath,
    )

    // Get file statuses (M/A/D/R)
    const nameStatusRaw = await gitExec(
      ['diff', '--name-status', `${baseBranch}...HEAD`],
      worktreePath,
    )

    // Get raw diff (for display), truncated
    let rawDiff = await gitExec(
      ['diff', `${baseBranch}...HEAD`],
      worktreePath,
    )
    if (rawDiff.length > MAX_RAW_DIFF_BYTES) {
      rawDiff = rawDiff.slice(0, MAX_RAW_DIFF_BYTES) + '\n\n--- Diff truncated at 100 KB ---'
    }

    // Parse --name-status into a map: path -> status
    const statusMap = new Map<string, DiffFileStat['status']>()
    for (const line of nameStatusRaw.split('\n').filter((l) => l.length > 0)) {
      const [code, ...pathParts] = line.split('\t')
      const filePath = pathParts[pathParts.length - 1] // For renames, take the new path
      const status = code.charAt(0) as DiffFileStat['status']
      if (filePath) {
        statusMap.set(filePath, status)
      }
    }

    // Parse --numstat into file stats
    const files: DiffFileStat[] = []
    let totalInsertions = 0
    let totalDeletions = 0

    for (const line of numstatRaw.split('\n').filter((l) => l.length > 0)) {
      const parts = line.split('\t')
      if (parts.length < 3) continue

      const insertions = parts[0] === '-' ? 0 : parseInt(parts[0], 10)
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10)
      const filePath = parts[2]

      totalInsertions += insertions
      totalDeletions += deletions

      files.push({
        path: filePath,
        status: statusMap.get(filePath) ?? 'M',
        insertions,
        deletions,
      })
    }

    return {
      filesChanged: files.length,
      insertions: totalInsertions,
      deletions: totalDeletions,
      files,
      rawDiff,
    }
  }

  /**
   * Merge a worktree branch into the target branch using --no-ff.
   * On conflict, aborts the merge and returns conflicted file list.
   */
  async merge(repoRoot: string, worktreeBranch: string, targetBranch: string): Promise<MergeResult> {
    log(`merge: ${worktreeBranch} into ${targetBranch} in ${repoRoot}`)

    await gitExec(['checkout', targetBranch], repoRoot)

    try {
      const output = await gitExec(
        ['merge', '--no-ff', worktreeBranch, '-m', `Merge sandbox run (${worktreeBranch})`],
        repoRoot,
      )

      // Parse merged files from merge output
      const merged: string[] = []
      for (const line of output.split('\n')) {
        // Lines like " src/file.ts | 5 ++"
        const match = line.match(/^\s+(\S+)\s+\|/)
        if (match) {
          merged.push(match[1])
        }
      }

      return { ok: true, conflicted: [], merged, message: output.trim() }
    } catch (err) {
      log(`merge conflict detected, aborting`)

      // Get list of conflicted files before aborting
      let conflicted: string[] = []
      try {
        const statusOut = await gitExec(['status', '--porcelain'], repoRoot)
        conflicted = statusOut
          .split('\n')
          .filter((l) => l.startsWith('UU') || l.startsWith('AA') || l.startsWith('DD'))
          .map((l) => l.slice(3).trim())
      } catch {
        // Ignore status errors
      }

      try {
        await gitExec(['merge', '--abort'], repoRoot)
      } catch {
        log(`merge --abort failed`)
      }

      return {
        ok: false,
        conflicted,
        merged: [],
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Hard-reset the worktree to the base branch state, effectively reverting all changes.
   */
  async revert(worktreePath: string, baseBranch: string): Promise<void> {
    log(`revert: reset to ${baseBranch} in ${worktreePath}`)
    await gitExec(['reset', '--hard', baseBranch], worktreePath)
  }
}
