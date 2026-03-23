import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { WorktreeManager } from '../worktree-manager'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clui-wt-test-'))
  git(['init', '-b', 'main'], dir)
  git(['config', 'user.email', 'test@test.com'], dir)
  git(['config', 'user.name', 'Test'], dir)
  git(['config', 'commit.gpgsign', 'false'], dir)
  writeFileSync(join(dir, 'README.md'), '# Test\n')
  git(['add', '.'], dir)
  git(['commit', '-m', 'initial'], dir)
  return dir
}

describe('WorktreeManager', () => {
  let repoDir: string
  let manager: WorktreeManager

  beforeEach(() => {
    repoDir = initRepo()
    manager = new WorktreeManager()
  })

  afterEach(async () => {
    await manager.cleanupAll()
    await rm(repoDir, { recursive: true, force: true })
  })

  it('creates a worktree with correct path and branch', async () => {
    const runId = 'abc123def456xyz789'
    const info = await manager.createWorktree(repoDir, runId)

    const expectedId = runId.slice(0, 12)
    expect(info.path).toBe(join(repoDir, '.clui-sandboxes', expectedId))
    expect(info.branch).toBe(`clui-sandbox-${expectedId}`)
    expect(info.runId).toBe(runId)
    expect(info.baseBranch).toBe('main')
    expect(info.createdAt).toBeGreaterThan(0)

    // Worktree directory should exist
    expect(existsSync(info.path)).toBe(true)

    // Branch should exist in the repo
    const branches = git(['branch', '--list'], repoDir)
    expect(branches).toContain(info.branch)
  })

  it('tracks worktree via getWorktree', async () => {
    const runId = 'trackme12345678'
    expect(manager.getWorktree(runId)).toBeNull()

    await manager.createWorktree(repoDir, runId)
    const info = manager.getWorktree(runId)
    expect(info).not.toBeNull()
    expect(info!.runId).toBe(runId)
  })

  it('removes worktree and cleans up branch', async () => {
    const runId = 'removeme1234567'
    const info = await manager.createWorktree(repoDir, runId)

    expect(existsSync(info.path)).toBe(true)

    await manager.removeWorktree(runId)

    expect(existsSync(info.path)).toBe(false)
    expect(manager.getWorktree(runId)).toBeNull()

    // Branch should be deleted
    const branches = git(['branch', '--list'], repoDir)
    expect(branches).not.toContain(info.branch)
  })

  it('throws on non-git directory', async () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), 'clui-nongit-'))
    try {
      await expect(manager.createWorktree(nonGitDir, 'test123456789'))
        .rejects.toThrow('Not a git repository')
    } finally {
      await rm(nonGitDir, { recursive: true, force: true })
    }
  })

  it('cleanupAll removes all tracked worktrees', async () => {
    const info1 = await manager.createWorktree(repoDir, 'run1-abcdef123456')
    const info2 = await manager.createWorktree(repoDir, 'run2-abcdef789012')

    expect(existsSync(info1.path)).toBe(true)
    expect(existsSync(info2.path)).toBe(true)

    await manager.cleanupAll()

    expect(existsSync(info1.path)).toBe(false)
    expect(existsSync(info2.path)).toBe(false)
    expect(manager.getWorktree('run1-abcdef123456')).toBeNull()
    expect(manager.getWorktree('run2-abcdef789012')).toBeNull()
  })
})
