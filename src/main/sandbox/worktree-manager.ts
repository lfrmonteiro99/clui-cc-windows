import { join } from 'path'
import { existsSync, symlinkSync, lstatSync } from 'fs'
import { rm } from 'fs/promises'
import type { WorktreeInfo } from '../../shared/sandbox-types'
import { gitExec, isGitRepo } from './git-exec'
import { log as _log } from '../logger'

function log(msg: string): void {
  _log('WorktreeManager', msg)
}

const SANDBOX_DIR = '.clui-sandboxes'

function shortId(runId: string): string {
  return runId.slice(0, 12)
}

export class WorktreeManager {
  private handles = new Map<string, WorktreeInfo>()

  /**
   * Create a git worktree for a sandbox run.
   * Path: <projectRoot>/.clui-sandboxes/<runId-first-12>
   * Branch: clui-sandbox-<runId-first-12>
   */
  async createWorktree(projectRoot: string, runId: string): Promise<WorktreeInfo> {
    if (!await isGitRepo(projectRoot)) {
      throw new Error(`Not a git repository: ${projectRoot}`)
    }

    const id = shortId(runId)
    const worktreePath = join(projectRoot, SANDBOX_DIR, id)
    const branch = `clui-sandbox-${id}`

    // Get current branch as base
    const baseBranch = (await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], projectRoot)).trim()

    log(`creating worktree: ${worktreePath} (branch: ${branch}, base: ${baseBranch})`)
    await gitExec(['worktree', 'add', '-b', branch, worktreePath], projectRoot)

    // Symlink dependency directories so the worktree can run tests/builds
    this.symlinkDeps(projectRoot, worktreePath)

    const info: WorktreeInfo = {
      path: worktreePath,
      branch,
      runId,
      baseBranch,
      createdAt: Date.now(),
    }

    this.handles.set(runId, info)
    return info
  }

  /**
   * Remove a worktree and its associated branch.
   * Falls back to rm -rf if git worktree remove fails.
   */
  async removeWorktree(runId: string): Promise<void> {
    const info = this.handles.get(runId)
    if (!info) {
      log(`no tracked worktree for runId: ${runId}`)
      return
    }

    log(`removing worktree: ${info.path}`)

    try {
      await gitExec(['worktree', 'remove', '--force', info.path], join(info.path, '..', '..'))
    } catch (err) {
      log(`git worktree remove failed, falling back to rm: ${err}`)
      try {
        await rm(info.path, { recursive: true, force: true })
      } catch (rmErr) {
        log(`rm fallback also failed: ${rmErr}`)
      }
    }

    // Clean up the branch
    try {
      // We need to run branch delete from the parent repo, not the worktree
      const parentRepo = join(info.path, '..', '..')
      await gitExec(['branch', '-D', info.branch], parentRepo)
    } catch (err) {
      log(`branch delete failed (may already be gone): ${err}`)
    }

    this.handles.delete(runId)
  }

  /**
   * Symlink common dependency/build directories from the original repo
   * into the worktree so tests and builds work without reinstalling.
   */
  private symlinkDeps(sourceRoot: string, worktreePath: string): void {
    const dirs = ['node_modules', 'vendor', '.venv', 'dist', 'build', '.next', '.nuxt']
    for (const dir of dirs) {
      const source = join(sourceRoot, dir)
      const target = join(worktreePath, dir)
      try {
        if (existsSync(source) && !existsSync(target)) {
          // Use 'junction' on Windows (no admin required), 'dir' symlink on POSIX
          const type = process.platform === 'win32' ? 'junction' : 'dir'
          symlinkSync(source, target, type)
          log(`symlinked ${dir} → ${source}`)
        }
      } catch (err) {
        log(`symlink failed for ${dir}: ${err}`)
      }
    }
  }

  /**
   * Get worktree info for a run, or null if not tracked.
   */
  getWorktree(runId: string): WorktreeInfo | null {
    return this.handles.get(runId) ?? null
  }

  /**
   * Clean up all tracked worktrees.
   */
  async cleanupAll(): Promise<void> {
    const runIds = Array.from(this.handles.keys())
    log(`cleaning up ${runIds.length} worktrees`)
    for (const runId of runIds) {
      try {
        await this.removeWorktree(runId)
      } catch (err) {
        log(`cleanup failed for ${runId}: ${err}`)
      }
    }
  }
}
