import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { GitDiffEngine } from '../git-diff-engine'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
}

function initRepoWithBranch(): { repoDir: string; worktreePath: string; baseBranch: string; sandboxBranch: string } {
  const repoDir = mkdtempSync(join(tmpdir(), 'clui-diff-test-'))
  git(['init', '-b', 'main'], repoDir)
  git(['config', 'user.email', 'test@test.com'], repoDir)
  git(['config', 'user.name', 'Test'], repoDir)

  // Create initial commit on main
  writeFileSync(join(repoDir, 'file1.txt'), 'original content\n')
  writeFileSync(join(repoDir, 'file2.txt'), 'file2 content\n')
  git(['add', '.'], repoDir)
  git(['commit', '-m', 'initial'], repoDir)

  // Create a sandbox worktree
  const worktreePath = join(repoDir, '.clui-sandboxes', 'testrun')
  const sandboxBranch = 'clui-sandbox-testrun'
  git(['worktree', 'add', '-b', sandboxBranch, worktreePath], repoDir)

  // Make changes in the worktree
  writeFileSync(join(worktreePath, 'file1.txt'), 'modified content\nnew line\n')
  writeFileSync(join(worktreePath, 'newfile.txt'), 'brand new file\n')
  git(['add', '.'], worktreePath)
  git(['commit', '-m', 'sandbox changes'], worktreePath)

  return { repoDir, worktreePath, baseBranch: 'main', sandboxBranch }
}

describe('GitDiffEngine', () => {
  let repoDir: string
  let worktreePath: string
  let baseBranch: string
  let sandboxBranch: string
  let engine: GitDiffEngine

  beforeEach(() => {
    const setup = initRepoWithBranch()
    repoDir = setup.repoDir
    worktreePath = setup.worktreePath
    baseBranch = setup.baseBranch
    sandboxBranch = setup.sandboxBranch
    engine = new GitDiffEngine()
  })

  afterEach(async () => {
    // Must remove worktree before deleting the repo
    try {
      git(['worktree', 'remove', '--force', worktreePath], repoDir)
    } catch { /* may already be gone */ }
    await rm(repoDir, { recursive: true, force: true })
  })

  it('getDiff returns correct file stats', async () => {
    const diff = await engine.getDiff(worktreePath, baseBranch)

    expect(diff.filesChanged).toBe(2) // file1.txt modified + newfile.txt added
    expect(diff.insertions).toBeGreaterThan(0)
    expect(diff.files.length).toBe(2)

    const file1 = diff.files.find((f) => f.path === 'file1.txt')
    expect(file1).toBeDefined()
    expect(file1!.status).toBe('M')

    const newFile = diff.files.find((f) => f.path === 'newfile.txt')
    expect(newFile).toBeDefined()
    expect(newFile!.status).toBe('A')
  })

  it('getDiff includes raw diff content', async () => {
    const diff = await engine.getDiff(worktreePath, baseBranch)

    expect(diff.rawDiff).toContain('modified content')
    expect(diff.rawDiff).toContain('brand new file')
  })

  it('getDiff returns empty summary when no changes', async () => {
    // Reset sandbox to match main
    git(['reset', '--hard', baseBranch], worktreePath)

    const diff = await engine.getDiff(worktreePath, baseBranch)
    expect(diff.filesChanged).toBe(0)
    expect(diff.files).toEqual([])
  })

  it('merge performs a clean merge', async () => {
    const result = await engine.merge(repoDir, sandboxBranch, baseBranch)

    expect(result.ok).toBe(true)
    expect(result.conflicted).toEqual([])

    // Verify we're on the base branch and changes are present
    const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir).trim()
    expect(currentBranch).toBe(baseBranch)

    // The merged file should have the new content
    const content = git(['show', 'HEAD:file1.txt'], repoDir)
    expect(content).toContain('modified content')
  })

  it('merge detects conflicts and aborts', async () => {
    // Create a conflicting change on main
    writeFileSync(join(repoDir, 'file1.txt'), 'conflicting content on main\n')
    git(['add', '.'], repoDir)
    git(['commit', '-m', 'conflicting change'], repoDir)

    const result = await engine.merge(repoDir, sandboxBranch, baseBranch)

    expect(result.ok).toBe(false)
    expect(result.conflicted.length).toBeGreaterThan(0)

    // Verify merge was aborted (we should still be on baseBranch with no ongoing merge)
    const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir).trim()
    expect(currentBranch).toBe(baseBranch)
  })

  it('revert resets worktree to base branch', async () => {
    await engine.revert(worktreePath, baseBranch)

    // After revert, file1 should have original content
    const content = git(['show', 'HEAD:file1.txt'], worktreePath)
    expect(content).toBe('original content\n')
  })
})
