# Sandbox Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Sandbox Mode" that runs AI in isolated git worktrees, shows post-run diffs with merge/revert, warns about dirty state, provides a file tree explorer, and a stash browser.

**Architecture:** New `src/main/sandbox/` module handles all git operations (worktree lifecycle, diff, merge, stash). A new Zustand store (`sandboxStore.ts`) manages renderer state. 9 new IPC channels wire main↔renderer. The ControlPlane's `_dispatch()` is modified to create worktrees pre-run and generate diffs post-run. 6 new React components render the UI.

**Tech Stack:** TypeScript, Electron IPC (ipcMain.handle), Node.js child_process.execFile (git CLI), Zustand, React 19, Framer Motion, Phosphor Icons, Tailwind CSS 4.

**Spec:** `docs/superpowers/specs/2026-03-23-sandbox-mode-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `src/shared/sandbox-types.ts` | All sandbox type definitions shared main↔renderer |
| `src/main/sandbox/git-exec.ts` | Safe git command executor (wraps execFile, timeout, error handling) |
| `src/main/sandbox/worktree-manager.ts` | Create/remove/track worktrees per run |
| `src/main/sandbox/git-diff-engine.ts` | Diff generation, merge, revert operations |
| `src/main/sandbox/dirty-detector.ts` | Pre-run dirty state check, auto-stash |
| `src/main/sandbox/stash-manager.ts` | Stash list, per-stash diff, metadata |
| `src/main/sandbox/file-lister.ts` | Directory listing with git status + .gitignore |
| `src/main/sandbox/index.ts` | Module barrel export |
| `src/renderer/stores/sandboxStore.ts` | Zustand store for sandbox UI state |
| `src/renderer/components/SandboxToggle.tsx` | On/off toggle in SettingsPopover |
| `src/renderer/components/DirtyStateWarning.tsx` | Pre-run warning card |
| `src/renderer/components/SandboxRunSummary.tsx` | Post-run diff + merge/revert panel |
| `src/renderer/components/FileTreePanel.tsx` | File tree sidebar |
| `src/renderer/components/FileTreeNode.tsx` | Recursive tree node |
| `src/renderer/components/StashBrowser.tsx` | Stash list + diff modal |

### Modified Files

| File | What Changes |
|------|-------------|
| `src/shared/types.ts` | 9 IPC channels, 4 NormalizedEvent types, RunOptions.sandbox fields, TabState.sandboxState |
| `src/shared/command-palette.ts` | 5 new palette commands |
| `src/shared/keyboard-shortcuts.ts` | 4 new shortcut action IDs |
| `src/main/index.ts` | Import sandbox module, register 9 IPC handlers |
| `src/main/claude/control-plane.ts` | Pre-run dirty check + worktree creation in `_dispatch()`, post-run diff in exit handler, cleanup in `closeTab()` |
| `src/preload/index.ts` | Expose 9 sandbox methods on `window.clui` |
| `src/renderer/stores/sessionStore.impl.ts` | Handle 4 new sandbox NormalizedEvent types |
| `src/renderer/components/SettingsPopover.tsx` | Add SandboxToggle row |
| `src/renderer/components/InputBar.tsx` | Show DirtyStateWarning before prompt submission |
| `src/renderer/components/CommandPalette.tsx` | Include sandbox commands |

---

## Task 1: Shared Types & IPC Contract

**Files:**
- Create: `src/shared/sandbox-types.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Create sandbox-types.ts with all type definitions**

```typescript
// src/shared/sandbox-types.ts

// ─── Dirty State ───
export interface DirtyState {
  isDirty: boolean
  untracked: string[]
  unstaged: string[]
  stashCount: number
  summary: string
}

// ─── Diff ───
export interface DiffFileStat {
  path: string
  status: 'M' | 'A' | 'D' | 'R'
  insertions: number
  deletions: number
}

export interface DiffSummary {
  filesChanged: number
  insertions: number
  deletions: number
  files: DiffFileStat[]
  rawDiff: string // truncated at 100KB
}

// ─── Merge ───
export interface MergeResult {
  ok: boolean
  conflicted: string[]
  merged: string[]
  message?: string
}

// ─── Worktree ───
export interface WorktreeInfo {
  path: string
  branch: string
  runId: string
  baseBranch: string
  createdAt: number
}

// ─── Stash ───
export interface StashEntry {
  index: number
  ref: string
  message: string
  timestamp: number
  branch: string
  fileCount: number
}

// ─── File Tree ───
export interface FileTreeEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  gitStatus?: 'M' | 'A' | 'D' | '?' | null
}

export interface DirectoryListing {
  basePath: string
  entries: FileTreeEntry[]
  truncated: boolean
}

// ─── Sandbox Run Options (extend RunOptions) ───
export interface SandboxOptions {
  enableWorktree?: boolean
  enableDirtyCheck?: boolean
  autoStash?: boolean
  skipDirtyCheck?: boolean
}

// ─── Sandbox Tab State ───
export interface SandboxTabState {
  enabled: boolean
  activeWorktree: WorktreeInfo | null
  pendingDiff: DiffSummary | null
  mergeStatus: 'idle' | 'pending' | 'merging' | 'merged' | 'reverted' | 'conflict'
}
```

- [ ] **Step 2: Add IPC channels and event types to types.ts**

In `src/shared/types.ts`, add to the `IPC` const (after the `GIT_DIFF` line ~587):

```typescript
  // Sandbox
  SANDBOX_CHECK_DIRTY: 'clui:sandbox-check-dirty',
  SANDBOX_GET_DIFF: 'clui:sandbox-get-diff',
  SANDBOX_MERGE: 'clui:sandbox-merge',
  SANDBOX_REVERT: 'clui:sandbox-revert',
  SANDBOX_AUTO_STASH: 'clui:sandbox-auto-stash',
  SANDBOX_LIST_FILES: 'clui:sandbox-list-files',
  SANDBOX_LIST_STASHES: 'clui:sandbox-list-stashes',
  SANDBOX_GET_STASH_DIFF: 'clui:sandbox-get-stash-diff',
  SANDBOX_WORKTREE_STATUS: 'clui:sandbox-worktree-status',
```

Add sandbox fields to `RunOptions` (after `wslDistro` ~331):

```typescript
  /** Sandbox mode options */
  sandbox?: import('./sandbox-types').SandboxOptions
```

Add sandbox state to `TabState` (after `lastActivityAt` ~240):

```typescript
  /** Sandbox mode state for this tab */
  sandboxState: import('./sandbox-types').SandboxTabState
```

Add sandbox events to `NormalizedEvent` union:

```typescript
  | { type: 'sandbox_worktree_created'; worktreeInfo: import('./sandbox-types').WorktreeInfo }
  | { type: 'sandbox_diff_ready'; runId: string; diff: import('./sandbox-types').DiffSummary }
  | { type: 'sandbox_merge_done'; runId: string; result: import('./sandbox-types').MergeResult }
  | { type: 'sandbox_dirty_warning'; runId: string; dirty: import('./sandbox-types').DirtyState }
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit --pretty`
Expected: 0 errors

---

## Task 2: Git Executor & Worktree Manager (Main Process)

**Files:**
- Create: `src/main/sandbox/git-exec.ts`
- Create: `src/main/sandbox/worktree-manager.ts`
- Test: `src/main/sandbox/__tests__/worktree-manager.test.ts`

- [ ] **Step 1: Write git-exec.ts — safe git command executor**

```typescript
// src/main/sandbox/git-exec.ts
import { execFile } from 'child_process'
import { log as _log } from '../logger'

const DEFAULT_TIMEOUT = 15_000
const MAX_BUFFER = 2 * 1024 * 1024 // 2 MB

function log(msg: string): void {
  _log('SandboxGit', msg)
}

export class GitExecError extends Error {
  constructor(
    public readonly command: string,
    public readonly args: string[],
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(`git ${args[0]} failed (exit ${exitCode}): ${stderr.slice(0, 200)}`)
    this.name = 'GitExecError'
  }
}

/**
 * Execute a git command safely via execFile (no shell injection).
 * Returns stdout as string. Throws GitExecError on failure.
 */
export function gitExec(
  args: string[],
  cwd: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<string> {
  return new Promise((resolve, reject) => {
    log(`exec: git ${args.join(' ')} (cwd=${cwd})`)
    execFile('git', args, { cwd, maxBuffer: MAX_BUFFER, timeout }, (error, stdout, stderr) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException & { code?: number }).code
        reject(new GitExecError('git', args, stderr || error.message, typeof code === 'number' ? code : null))
      } else {
        resolve(stdout)
      }
    })
  })
}

/**
 * Check if cwd is inside a git repository.
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await gitExec(['rev-parse', '--git-dir'], cwd, 5000)
    return true
  } catch {
    return false
  }
}

/**
 * Guard: reject if repo is in merge/rebase/cherry-pick state.
 */
export async function guardRepoState(cwd: string): Promise<void> {
  const gitDir = (await gitExec(['rev-parse', '--git-dir'], cwd)).trim()
  const { existsSync } = await import('fs')
  const { join } = await import('path')
  const base = join(cwd, gitDir)

  if (existsSync(join(base, 'MERGE_HEAD'))) throw new Error('Repository has an in-progress merge')
  if (existsSync(join(base, 'rebase-merge')) || existsSync(join(base, 'rebase-apply'))) {
    throw new Error('Repository has an in-progress rebase')
  }
  if (existsSync(join(base, 'CHERRY_PICK_HEAD'))) throw new Error('Repository has an in-progress cherry-pick')
}
```

- [ ] **Step 2: Write worktree-manager.ts**

```typescript
// src/main/sandbox/worktree-manager.ts
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { gitExec, isGitRepo, guardRepoState } from './git-exec'
import { log as _log } from '../logger'
import type { WorktreeInfo } from '../../shared/sandbox-types'

function log(msg: string): void { _log('WorktreeManager', msg) }

const WORKTREE_DIR = '.clui-sandboxes'

export class WorktreeManager {
  private handles = new Map<string, WorktreeInfo>()

  /**
   * Create an isolated worktree for a run.
   * The worktree is placed at <projectRoot>/.clui-sandboxes/<runId>
   * on a new branch clui-sandbox-<runId>.
   */
  async createWorktree(projectRoot: string, runId: string): Promise<WorktreeInfo> {
    if (!await isGitRepo(projectRoot)) {
      throw new Error('Not a git repository — cannot create sandbox worktree')
    }
    await guardRepoState(projectRoot)

    const branch = `clui-sandbox-${runId.slice(0, 12)}`
    const dir = join(projectRoot, WORKTREE_DIR)
    const worktreePath = join(dir, runId.slice(0, 12))

    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    // Get current branch as base
    const baseBranch = (await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], projectRoot)).trim()

    // Create the worktree
    await gitExec(['worktree', 'add', '-b', branch, worktreePath], projectRoot)

    const info: WorktreeInfo = {
      path: worktreePath,
      branch,
      runId,
      baseBranch,
      createdAt: Date.now(),
    }
    this.handles.set(runId, info)
    log(`Created worktree: ${worktreePath} (branch=${branch}, base=${baseBranch})`)
    return info
  }

  /**
   * Remove a worktree and its branch.
   */
  async removeWorktree(runId: string): Promise<void> {
    const info = this.handles.get(runId)
    if (!info) return

    try {
      // Get the main repo root (parent of the worktree dir)
      const repoRoot = join(info.path, '..', '..')
      await gitExec(['worktree', 'remove', '--force', info.path], repoRoot)
      log(`Removed worktree: ${info.path}`)
    } catch (err) {
      log(`Worktree remove failed, cleaning up manually: ${(err as Error).message}`)
      try {
        await rm(info.path, { recursive: true, force: true })
      } catch { /* best-effort */ }
    }

    try {
      const repoRoot = join(info.path, '..', '..')
      await gitExec(['branch', '-D', info.branch], repoRoot)
    } catch { /* branch may already be gone */ }

    this.handles.delete(runId)
  }

  getWorktree(runId: string): WorktreeInfo | null {
    return this.handles.get(runId) || null
  }

  /** Clean up all tracked worktrees (called on app exit). */
  async cleanupAll(): Promise<void> {
    for (const runId of this.handles.keys()) {
      await this.removeWorktree(runId).catch(() => {})
    }
  }
}
```

- [ ] **Step 3: Write unit test for worktree manager**

```typescript
// src/main/sandbox/__tests__/worktree-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorktreeManager } from '../worktree-manager'
import { execFileSync } from 'child_process'
import { mkdtempSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { rm } from 'fs/promises'

describe('WorktreeManager', () => {
  let tmpDir: string
  let manager: WorktreeManager

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'clui-sandbox-test-'))
    execFileSync('git', ['init', tmpDir])
    execFileSync('git', ['-C', tmpDir, 'config', 'user.email', 'test@test.com'])
    execFileSync('git', ['-C', tmpDir, 'config', 'user.name', 'Test'])
    writeFileSync(join(tmpDir, 'README.md'), '# Test')
    execFileSync('git', ['-C', tmpDir, 'add', '.'])
    execFileSync('git', ['-C', tmpDir, 'commit', '-m', 'init'])
    manager = new WorktreeManager()
  })

  afterEach(async () => {
    await manager.cleanupAll()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('creates and removes a worktree', async () => {
    const info = await manager.createWorktree(tmpDir, 'test-run-001')
    expect(info.path).toContain('clui-sandboxes')
    expect(info.branch).toBe('clui-sandbox-test-run-001')
    expect(existsSync(info.path)).toBe(true)

    await manager.removeWorktree('test-run-001')
    expect(manager.getWorktree('test-run-001')).toBeNull()
  })

  it('throws if not a git repo', async () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), 'non-git-'))
    await expect(manager.createWorktree(nonGitDir, 'run-1')).rejects.toThrow('Not a git repository')
    await rm(nonGitDir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/main/sandbox/__tests__/worktree-manager.test.ts`
Expected: PASS

---

## Task 3: Git Diff Engine (Main Process)

**Files:**
- Create: `src/main/sandbox/git-diff-engine.ts`
- Test: `src/main/sandbox/__tests__/git-diff-engine.test.ts`

- [ ] **Step 1: Write git-diff-engine.ts**

```typescript
// src/main/sandbox/git-diff-engine.ts
import { gitExec } from './git-exec'
import { log as _log } from '../logger'
import type { DiffSummary, DiffFileStat, MergeResult } from '../../shared/sandbox-types'

function log(msg: string): void { _log('GitDiffEngine', msg) }

const MAX_DIFF_BYTES = 100 * 1024 // 100 KB

export class GitDiffEngine {
  /**
   * Generate diff between worktree HEAD and base branch.
   */
  async getDiff(worktreePath: string, baseBranch: string): Promise<DiffSummary> {
    // Get file-level stats
    const numstat = await gitExec(['diff', '--numstat', `${baseBranch}...HEAD`], worktreePath)
    const nameStatus = await gitExec(['diff', '--name-status', `${baseBranch}...HEAD`], worktreePath)

    const files = this.parseFiles(numstat, nameStatus)
    const insertions = files.reduce((s, f) => s + f.insertions, 0)
    const deletions = files.reduce((s, f) => s + f.deletions, 0)

    // Get raw unified diff (truncated)
    let rawDiff = await gitExec(['diff', `${baseBranch}...HEAD`], worktreePath)
    if (rawDiff.length > MAX_DIFF_BYTES) {
      rawDiff = rawDiff.slice(0, MAX_DIFF_BYTES) + '\n\n--- Diff truncated at 100 KB ---'
    }

    log(`Diff: ${files.length} files, +${insertions} -${deletions}`)
    return { filesChanged: files.length, insertions, deletions, files, rawDiff }
  }

  /**
   * Merge worktree branch into the base branch (from the main repo).
   */
  async merge(repoRoot: string, worktreeBranch: string, targetBranch: string): Promise<MergeResult> {
    try {
      // Ensure we're on the target branch
      await gitExec(['checkout', targetBranch], repoRoot)
      const output = await gitExec(
        ['merge', '--no-ff', worktreeBranch, '-m', `Merge sandbox run (${worktreeBranch})`],
        repoRoot,
      )
      log(`Merge success: ${worktreeBranch} → ${targetBranch}`)
      return { ok: true, conflicted: [], merged: [output.trim()], message: output }
    } catch (err) {
      const msg = (err as Error).message || ''
      if (msg.includes('CONFLICT') || msg.includes('Merge conflict')) {
        const conflicted = await this.getConflictedFiles(repoRoot)
        // Abort the failed merge
        await gitExec(['merge', '--abort'], repoRoot).catch(() => {})
        log(`Merge conflict: ${conflicted.join(', ')}`)
        return { ok: false, conflicted, merged: [], message: msg }
      }
      throw err
    }
  }

  /**
   * Revert: discard worktree by removing it (caller handles via WorktreeManager).
   */
  async revert(worktreePath: string, baseBranch: string): Promise<void> {
    await gitExec(['reset', '--hard', baseBranch], worktreePath)
    log(`Reverted worktree to ${baseBranch}`)
  }

  private parseFiles(numstat: string, nameStatus: string): DiffFileStat[] {
    const statusMap = new Map<string, 'M' | 'A' | 'D' | 'R'>()
    for (const line of nameStatus.split('\n').filter(Boolean)) {
      const [status, ...pathParts] = line.split('\t')
      const path = pathParts[pathParts.length - 1] || pathParts[0]
      if (path) {
        const s = status.charAt(0) as 'M' | 'A' | 'D' | 'R'
        statusMap.set(path, ['M', 'A', 'D', 'R'].includes(s) ? s : 'M')
      }
    }

    const files: DiffFileStat[] = []
    for (const line of numstat.split('\n').filter(Boolean)) {
      const [add, del, path] = line.split('\t')
      if (path) {
        files.push({
          path,
          status: statusMap.get(path) || 'M',
          insertions: add === '-' ? 0 : parseInt(add, 10) || 0,
          deletions: del === '-' ? 0 : parseInt(del, 10) || 0,
        })
      }
    }
    return files
  }

  private async getConflictedFiles(repoRoot: string): Promise<string[]> {
    try {
      const stdout = await gitExec(['diff', '--name-only', '--diff-filter=U'], repoRoot)
      return stdout.split('\n').filter(Boolean)
    } catch {
      return []
    }
  }
}
```

- [ ] **Step 2: Write unit test**

```typescript
// src/main/sandbox/__tests__/git-diff-engine.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitDiffEngine } from '../git-diff-engine'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { rm } from 'fs/promises'

describe('GitDiffEngine', () => {
  let tmpDir: string
  let engine: GitDiffEngine

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'clui-diff-test-'))
    execFileSync('git', ['init', tmpDir])
    execFileSync('git', ['-C', tmpDir, 'config', 'user.email', 'test@test.com'])
    execFileSync('git', ['-C', tmpDir, 'config', 'user.name', 'Test'])
    writeFileSync(join(tmpDir, 'file.txt'), 'original\n')
    execFileSync('git', ['-C', tmpDir, 'add', '.'])
    execFileSync('git', ['-C', tmpDir, 'commit', '-m', 'init'])

    // Create a branch with changes
    execFileSync('git', ['-C', tmpDir, 'checkout', '-b', 'sandbox-branch'])
    writeFileSync(join(tmpDir, 'file.txt'), 'modified\nnew line\n')
    writeFileSync(join(tmpDir, 'new-file.txt'), 'added\n')
    execFileSync('git', ['-C', tmpDir, 'add', '.'])
    execFileSync('git', ['-C', tmpDir, 'commit', '-m', 'sandbox changes'])
    execFileSync('git', ['-C', tmpDir, 'checkout', 'main'])

    engine = new GitDiffEngine()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('generates diff summary', async () => {
    execFileSync('git', ['-C', tmpDir, 'checkout', 'sandbox-branch'])
    const diff = await engine.getDiff(tmpDir, 'main')
    expect(diff.filesChanged).toBeGreaterThan(0)
    expect(diff.insertions).toBeGreaterThan(0)
    expect(diff.rawDiff).toContain('diff --git')
  })

  it('merges cleanly', async () => {
    const result = await engine.merge(tmpDir, 'sandbox-branch', 'main')
    expect(result.ok).toBe(true)
    expect(result.conflicted).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/main/sandbox/__tests__/git-diff-engine.test.ts`
Expected: PASS

---

## Task 4: Dirty State Detector & Stash Manager (Main Process)

**Files:**
- Create: `src/main/sandbox/dirty-detector.ts`
- Create: `src/main/sandbox/stash-manager.ts`
- Create: `src/main/sandbox/file-lister.ts`
- Create: `src/main/sandbox/index.ts`
- Test: `src/main/sandbox/__tests__/dirty-detector.test.ts`

- [ ] **Step 1: Write dirty-detector.ts**

```typescript
// src/main/sandbox/dirty-detector.ts
import { gitExec, isGitRepo } from './git-exec'
import { log as _log } from '../logger'
import type { DirtyState } from '../../shared/sandbox-types'

function log(msg: string): void { _log('DirtyDetector', msg) }

export class DirtyDetector {
  async check(cwd: string): Promise<DirtyState> {
    if (!await isGitRepo(cwd)) {
      return { isDirty: false, untracked: [], unstaged: [], stashCount: 0, summary: 'Not a git repo' }
    }

    const stdout = await gitExec(['status', '--porcelain'], cwd, 10_000)
    const lines = stdout.split('\n').filter(Boolean)

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

    let stashCount = 0
    try {
      const stashOutput = await gitExec(['stash', 'list'], cwd, 5_000)
      stashCount = stashOutput.split('\n').filter(Boolean).length
    } catch { /* no stashes */ }

    const isDirty = untracked.length > 0 || unstaged.length > 0
    const parts: string[] = []
    if (unstaged.length) parts.push(`${unstaged.length} modified`)
    if (untracked.length) parts.push(`${untracked.length} untracked`)
    const summary = isDirty ? parts.join(', ') : 'Clean'

    log(`Dirty check: ${summary} (${stashCount} stashes)`)
    return { isDirty, untracked, unstaged, stashCount, summary }
  }

  async autoStash(cwd: string, message: string): Promise<string> {
    await gitExec(['stash', 'push', '-m', message], cwd)
    log(`Auto-stashed: ${message}`)
    return `stash@{0}`
  }
}
```

- [ ] **Step 2: Write stash-manager.ts**

```typescript
// src/main/sandbox/stash-manager.ts
import { gitExec, isGitRepo } from './git-exec'
import { log as _log } from '../logger'
import type { StashEntry } from '../../shared/sandbox-types'

function log(msg: string): void { _log('StashManager', msg) }

export class StashManager {
  async list(cwd: string): Promise<StashEntry[]> {
    if (!await isGitRepo(cwd)) return []

    const stdout = await gitExec(
      ['stash', 'list', '--format=%H%n%s%n%at%n%gd'],
      cwd,
    )
    if (!stdout.trim()) return []

    const lines = stdout.split('\n').filter(Boolean)
    const entries: StashEntry[] = []

    // Each stash produces 4 lines: hash, subject, timestamp, reflog
    for (let i = 0; i + 3 < lines.length; i += 4) {
      const message = lines[i + 1]
      const timestamp = parseInt(lines[i + 2], 10) * 1000
      const ref = lines[i + 3]
      const index = entries.length

      // Get file count
      let fileCount = 0
      try {
        const showOutput = await gitExec(['stash', 'show', '--name-only', `stash@{${index}}`], cwd)
        fileCount = showOutput.split('\n').filter(Boolean).length
      } catch { /* empty stash */ }

      const branchMatch = message.match(/on ([^:]+):/)
      entries.push({
        index,
        ref,
        message: message.replace(/^WIP on [^:]+: /, '').replace(/^On [^:]+: /, ''),
        timestamp,
        branch: branchMatch?.[1] || 'unknown',
        fileCount,
      })
    }

    log(`Listed ${entries.length} stashes`)
    return entries
  }

  async getDiff(cwd: string, index: number, file?: string): Promise<string> {
    const args = ['stash', 'show', '-p', `stash@{${index}}`]
    if (file) args.push('--', file)
    return gitExec(args, cwd)
  }
}
```

- [ ] **Step 3: Write file-lister.ts**

```typescript
// src/main/sandbox/file-lister.ts
import { readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { gitExec, isGitRepo } from './git-exec'
import type { FileTreeEntry, DirectoryListing } from '../../shared/sandbox-types'

const MAX_ENTRIES = 500
const MAX_DEPTH = 4

export class FileLister {
  async list(cwd: string, relativePath?: string, depth = 0): Promise<DirectoryListing> {
    const basePath = relativePath ? join(cwd, relativePath) : cwd
    const entries: FileTreeEntry[] = []
    let truncated = false

    // Get git status map
    const gitStatusMap = await this.getGitStatusMap(cwd)

    try {
      const items = readdirSync(basePath, { withFileTypes: true })
      for (const item of items) {
        if (entries.length >= MAX_ENTRIES) { truncated = true; break }
        if (item.name.startsWith('.') && item.name !== '.gitignore') continue
        if (item.name === 'node_modules' || item.name === '.clui-sandboxes') continue

        const fullPath = join(basePath, item.name)
        const relPath = relative(cwd, fullPath).replace(/\\/g, '/')

        if (item.isDirectory()) {
          entries.push({
            name: item.name,
            path: relPath,
            type: 'directory',
            gitStatus: null,
          })
        } else if (item.isFile()) {
          let size: number | undefined
          try { size = statSync(fullPath).size } catch { /* skip */ }
          entries.push({
            name: item.name,
            path: relPath,
            type: 'file',
            size,
            gitStatus: gitStatusMap.get(relPath) || null,
          })
        }
      }
    } catch {
      // Permission denied or path doesn't exist
    }

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return { basePath: relativePath || '.', entries, truncated }
  }

  private async getGitStatusMap(cwd: string): Promise<Map<string, 'M' | 'A' | 'D' | '?'>> {
    const map = new Map<string, 'M' | 'A' | 'D' | '?'>()
    if (!await isGitRepo(cwd)) return map

    try {
      const stdout = await gitExec(['status', '--porcelain'], cwd, 5_000)
      for (const line of stdout.split('\n').filter(Boolean)) {
        const xy = line.slice(0, 2)
        const path = line.slice(3).replace(/\\/g, '/')
        if (xy === '??') map.set(path, '?')
        else if (xy.includes('A')) map.set(path, 'A')
        else if (xy.includes('D')) map.set(path, 'D')
        else map.set(path, 'M')
      }
    } catch { /* not a repo or git not found */ }
    return map
  }
}
```

- [ ] **Step 4: Write barrel export (index.ts)**

```typescript
// src/main/sandbox/index.ts
export { WorktreeManager } from './worktree-manager'
export { GitDiffEngine } from './git-diff-engine'
export { DirtyDetector } from './dirty-detector'
export { StashManager } from './stash-manager'
export { FileLister } from './file-lister'
export { gitExec, isGitRepo, guardRepoState, GitExecError } from './git-exec'
```

- [ ] **Step 5: Write dirty detector test**

```typescript
// src/main/sandbox/__tests__/dirty-detector.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DirtyDetector } from '../dirty-detector'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { rm } from 'fs/promises'

describe('DirtyDetector', () => {
  let tmpDir: string
  let detector: DirtyDetector

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'clui-dirty-test-'))
    execFileSync('git', ['init', tmpDir])
    execFileSync('git', ['-C', tmpDir, 'config', 'user.email', 'test@test.com'])
    execFileSync('git', ['-C', tmpDir, 'config', 'user.name', 'Test'])
    writeFileSync(join(tmpDir, 'file.txt'), 'content')
    execFileSync('git', ['-C', tmpDir, 'add', '.'])
    execFileSync('git', ['-C', tmpDir, 'commit', '-m', 'init'])
    detector = new DirtyDetector()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('detects clean state', async () => {
    const state = await detector.check(tmpDir)
    expect(state.isDirty).toBe(false)
  })

  it('detects modified files', async () => {
    writeFileSync(join(tmpDir, 'file.txt'), 'changed')
    const state = await detector.check(tmpDir)
    expect(state.isDirty).toBe(true)
    expect(state.unstaged.length).toBeGreaterThan(0)
  })

  it('detects untracked files', async () => {
    writeFileSync(join(tmpDir, 'new.txt'), 'new')
    const state = await detector.check(tmpDir)
    expect(state.isDirty).toBe(true)
    expect(state.untracked).toContain('new.txt')
  })

  it('auto-stashes and restores clean state', async () => {
    writeFileSync(join(tmpDir, 'file.txt'), 'changed')
    await detector.autoStash(tmpDir, 'test stash')
    const state = await detector.check(tmpDir)
    expect(state.isDirty).toBe(false)
    expect(state.stashCount).toBe(1)
  })
})
```

- [ ] **Step 6: Run all sandbox tests**

Run: `npx vitest run src/main/sandbox/__tests__/`
Expected: All PASS

---

## Task 5: IPC Wiring (Main Process + Preload)

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Register sandbox IPC handlers in main/index.ts**

After the git context handlers (~line 588), add:

```typescript
import { WorktreeManager, GitDiffEngine, DirtyDetector, StashManager, FileLister } from './sandbox'
import type { DirtyState, DiffSummary, MergeResult, DirectoryListing, StashEntry, WorktreeInfo } from '../shared/sandbox-types'

const worktreeManager = new WorktreeManager()
const gitDiffEngine = new GitDiffEngine()
const dirtyDetector = new DirtyDetector()
const stashManager = new StashManager()
const fileLister = new FileLister()
```

Then register handlers after existing IPC handlers:

```typescript
  // ─── Sandbox Mode ───
  ipcMain.handle(IPC.SANDBOX_CHECK_DIRTY, async (_e, cwd: string) => dirtyDetector.check(cwd))

  ipcMain.handle(IPC.SANDBOX_GET_DIFF, async (_e, worktreePath: string, baseBranch: string) =>
    gitDiffEngine.getDiff(worktreePath, baseBranch))

  ipcMain.handle(IPC.SANDBOX_MERGE, async (_e, repoRoot: string, worktreeBranch: string, targetBranch: string) =>
    gitDiffEngine.merge(repoRoot, worktreeBranch, targetBranch))

  ipcMain.handle(IPC.SANDBOX_REVERT, async (_e, worktreePath: string, baseBranch: string) => {
    await gitDiffEngine.revert(worktreePath, baseBranch)
    return { ok: true }
  })

  ipcMain.handle(IPC.SANDBOX_AUTO_STASH, async (_e, cwd: string, message: string) => {
    const ref = await dirtyDetector.autoStash(cwd, message)
    return { ok: true, stashRef: ref }
  })

  ipcMain.handle(IPC.SANDBOX_LIST_FILES, async (_e, cwd: string, relativePath?: string) =>
    fileLister.list(cwd, relativePath))

  ipcMain.handle(IPC.SANDBOX_LIST_STASHES, async (_e, cwd: string) => stashManager.list(cwd))

  ipcMain.handle(IPC.SANDBOX_GET_STASH_DIFF, async (_e, cwd: string, index: number, file?: string) =>
    stashManager.getDiff(cwd, index, file))

  ipcMain.handle(IPC.SANDBOX_WORKTREE_STATUS, async (_e, runId: string) => {
    const wt = worktreeManager.getWorktree(runId)
    return wt ? { exists: true, path: wt.path, branch: wt.branch } : { exists: false }
  })
```

- [ ] **Step 2: Expose sandbox methods in preload/index.ts**

Add to the `CluiAPI` interface:

```typescript
  // Sandbox
  sandboxCheckDirty(cwd: string): Promise<DirtyState>
  sandboxGetDiff(worktreePath: string, baseBranch: string): Promise<DiffSummary>
  sandboxMerge(repoRoot: string, worktreeBranch: string, targetBranch: string): Promise<MergeResult>
  sandboxRevert(worktreePath: string, baseBranch: string): Promise<{ ok: boolean }>
  sandboxAutoStash(cwd: string, message: string): Promise<{ ok: boolean; stashRef: string }>
  sandboxListFiles(cwd: string, relativePath?: string): Promise<DirectoryListing>
  sandboxListStashes(cwd: string): Promise<StashEntry[]>
  sandboxGetStashDiff(cwd: string, index: number, file?: string): Promise<string>
  sandboxWorktreeStatus(runId: string): Promise<{ exists: boolean; path?: string; branch?: string }>
```

Add to the `api` implementation object:

```typescript
  // Sandbox
  sandboxCheckDirty: (cwd) => ipcRenderer.invoke(IPC.SANDBOX_CHECK_DIRTY, cwd),
  sandboxGetDiff: (wt, base) => ipcRenderer.invoke(IPC.SANDBOX_GET_DIFF, wt, base),
  sandboxMerge: (root, branch, target) => ipcRenderer.invoke(IPC.SANDBOX_MERGE, root, branch, target),
  sandboxRevert: (wt, base) => ipcRenderer.invoke(IPC.SANDBOX_REVERT, wt, base),
  sandboxAutoStash: (cwd, msg) => ipcRenderer.invoke(IPC.SANDBOX_AUTO_STASH, cwd, msg),
  sandboxListFiles: (cwd, rel) => ipcRenderer.invoke(IPC.SANDBOX_LIST_FILES, cwd, rel),
  sandboxListStashes: (cwd) => ipcRenderer.invoke(IPC.SANDBOX_LIST_STASHES, cwd),
  sandboxGetStashDiff: (cwd, idx, f) => ipcRenderer.invoke(IPC.SANDBOX_GET_STASH_DIFF, cwd, idx, f),
  sandboxWorktreeStatus: (runId) => ipcRenderer.invoke(IPC.SANDBOX_WORKTREE_STATUS, runId),
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit --pretty`
Expected: 0 errors

---

## Task 6: ControlPlane Integration (Worktree + Diff on Run)

**Files:**
- Modify: `src/main/claude/control-plane.ts`

- [ ] **Step 1: Add worktree creation in _dispatch()**

At the top of `control-plane.ts`, add imports:

```typescript
import { WorktreeManager } from '../sandbox/worktree-manager'
import { GitDiffEngine } from '../sandbox/git-diff-engine'
import { DirtyDetector } from '../sandbox/dirty-detector'
```

Add as class fields:

```typescript
private worktreeManager = new WorktreeManager()
private gitDiffEngine = new GitDiffEngine()
private dirtyDetector = new DirtyDetector()
```

In `_dispatch()`, after budget enforcement (~line 745) and before the transport pick (~line 774), add:

```typescript
    // ─── Sandbox Mode ───
    let sandboxWorktree: import('../../shared/sandbox-types').WorktreeInfo | null = null
    if (options.sandbox?.enableWorktree) {
      // Pre-run dirty check
      if (options.sandbox.enableDirtyCheck && !options.sandbox.skipDirtyCheck) {
        const dirty = await this.dirtyDetector.check(options.projectPath)
        if (dirty.isDirty) {
          this.emit('event', tabId, { type: 'sandbox_dirty_warning', runId: requestId, dirty })
          if (options.sandbox.autoStash) {
            await this.dirtyDetector.autoStash(options.projectPath, `CLUI auto-stash ${requestId}`)
          }
        }
      }

      // Create isolated worktree
      try {
        sandboxWorktree = await this.worktreeManager.createWorktree(options.projectPath, requestId)
        options = { ...options, projectPath: sandboxWorktree.path }
        this.emit('event', tabId, { type: 'sandbox_worktree_created', worktreeInfo: sandboxWorktree })
        log(`Sandbox worktree ready: ${sandboxWorktree.path}`)
      } catch (err) {
        log(`Sandbox worktree failed: ${(err as Error).message} — running in normal mode`)
      }
    }
```

- [ ] **Step 2: Add post-run diff generation in exit handler**

In the exit handler (where `code === 0` or run completes), add diff generation:

Find the exit handler section where `tab.activeRequestId` is cleared and add:

```typescript
    // Generate diff if this was a sandboxed run
    const wt = this.worktreeManager.getWorktree(requestId)
    if (wt) {
      try {
        const diff = await this.gitDiffEngine.getDiff(wt.path, wt.baseBranch)
        this.emit('event', tabId, { type: 'sandbox_diff_ready', runId: requestId, diff })
      } catch (err) {
        log(`Post-run diff failed: ${(err as Error).message}`)
      }
    }
```

- [ ] **Step 3: Add cleanup in closeTab()**

In the `closeTab()` method, before the tab is removed:

```typescript
    // Clean up sandbox worktrees for this tab
    for (const [runId] of this.worktreeManager['handles']) {
      // Only clean worktrees belonging to runs from this tab
      const inflight = this.inflightRequests.get(runId)
      if (inflight?.tabId === tabId) {
        this.worktreeManager.removeWorktree(runId).catch((err) => {
          log(`Worktree cleanup failed for ${runId}: ${(err as Error).message}`)
        })
      }
    }
```

- [ ] **Step 4: Verify build compiles**

Run: `npx tsc --noEmit --pretty`
Expected: 0 errors

---

## Task 7: Sandbox Zustand Store (Renderer)

**Files:**
- Create: `src/renderer/stores/sandboxStore.ts`
- Modify: `src/renderer/stores/sessionStore.impl.ts`

- [ ] **Step 1: Write sandboxStore.ts**

```typescript
// src/renderer/stores/sandboxStore.ts
import { create } from 'zustand'
import type {
  DirtyState, DiffSummary, MergeResult, WorktreeInfo,
  DirectoryListing, StashEntry, SandboxTabState,
} from '../../shared/sandbox-types'

interface SandboxState {
  // Per-tab sandbox state
  tabStates: Map<string, SandboxTabState>

  // File tree
  fileTreeOpen: boolean
  fileTreeCwd: string | null
  fileTreeEntries: DirectoryListing | null
  fileTreeLoading: boolean

  // Stash browser
  stashBrowserOpen: boolean
  stashList: StashEntry[]
  stashLoading: boolean
  selectedStashIndex: number | null
  stashDiff: string | null

  // Dirty warning
  pendingDirtyWarning: { tabId: string; runId: string; dirty: DirtyState } | null

  // Actions
  getTabState: (tabId: string) => SandboxTabState
  setEnabled: (tabId: string, enabled: boolean) => void
  setWorktree: (tabId: string, info: WorktreeInfo) => void
  setDiff: (tabId: string, diff: DiffSummary) => void
  setMergeStatus: (tabId: string, status: SandboxTabState['mergeStatus']) => void
  clearTabState: (tabId: string) => void

  setFileTreeOpen: (open: boolean) => void
  loadFileTree: (cwd: string, relativePath?: string) => Promise<void>

  setStashBrowserOpen: (open: boolean) => void
  loadStashes: (cwd: string) => Promise<void>
  loadStashDiff: (cwd: string, index: number) => Promise<void>

  setPendingDirtyWarning: (warning: SandboxState['pendingDirtyWarning']) => void
}

const DEFAULT_TAB_STATE: SandboxTabState = {
  enabled: false,
  activeWorktree: null,
  pendingDiff: null,
  mergeStatus: 'idle',
}

export const useSandboxStore = create<SandboxState>((set, get) => ({
  tabStates: new Map(),
  fileTreeOpen: false,
  fileTreeCwd: null,
  fileTreeEntries: null,
  fileTreeLoading: false,
  stashBrowserOpen: false,
  stashList: [],
  stashLoading: false,
  selectedStashIndex: null,
  stashDiff: null,
  pendingDirtyWarning: null,

  getTabState: (tabId) => get().tabStates.get(tabId) || DEFAULT_TAB_STATE,

  setEnabled: (tabId, enabled) => set((s) => {
    const next = new Map(s.tabStates)
    const prev = next.get(tabId) || { ...DEFAULT_TAB_STATE }
    next.set(tabId, { ...prev, enabled })
    return { tabStates: next }
  }),

  setWorktree: (tabId, info) => set((s) => {
    const next = new Map(s.tabStates)
    const prev = next.get(tabId) || { ...DEFAULT_TAB_STATE }
    next.set(tabId, { ...prev, activeWorktree: info })
    return { tabStates: next }
  }),

  setDiff: (tabId, diff) => set((s) => {
    const next = new Map(s.tabStates)
    const prev = next.get(tabId) || { ...DEFAULT_TAB_STATE }
    next.set(tabId, { ...prev, pendingDiff: diff, mergeStatus: 'pending' })
    return { tabStates: next }
  }),

  setMergeStatus: (tabId, status) => set((s) => {
    const next = new Map(s.tabStates)
    const prev = next.get(tabId) || { ...DEFAULT_TAB_STATE }
    next.set(tabId, { ...prev, mergeStatus: status })
    return { tabStates: next }
  }),

  clearTabState: (tabId) => set((s) => {
    const next = new Map(s.tabStates)
    next.delete(tabId)
    return { tabStates: next }
  }),

  setFileTreeOpen: (open) => set({ fileTreeOpen: open }),

  loadFileTree: async (cwd, relativePath) => {
    set({ fileTreeLoading: true, fileTreeCwd: cwd })
    try {
      const listing = await window.clui.sandboxListFiles(cwd, relativePath)
      set({ fileTreeEntries: listing, fileTreeLoading: false })
    } catch {
      set({ fileTreeLoading: false })
    }
  },

  setStashBrowserOpen: (open) => set({ stashBrowserOpen: open }),

  loadStashes: async (cwd) => {
    set({ stashLoading: true })
    try {
      const list = await window.clui.sandboxListStashes(cwd)
      set({ stashList: list, stashLoading: false })
    } catch {
      set({ stashLoading: false })
    }
  },

  loadStashDiff: async (cwd, index) => {
    set({ selectedStashIndex: index, stashDiff: null })
    try {
      const diff = await window.clui.sandboxGetStashDiff(cwd, index)
      set({ stashDiff: diff })
    } catch {
      set({ stashDiff: 'Error loading diff' })
    }
  },

  setPendingDirtyWarning: (warning) => set({ pendingDirtyWarning: warning }),
}))
```

- [ ] **Step 2: Handle sandbox events in sessionStore.impl.ts**

In the `handleNormalizedEvent` method, add cases for sandbox events:

```typescript
      case 'sandbox_worktree_created':
        useSandboxStore.getState().setWorktree(tabId, event.worktreeInfo)
        break

      case 'sandbox_diff_ready':
        useSandboxStore.getState().setDiff(tabId, event.diff)
        break

      case 'sandbox_merge_done':
        useSandboxStore.getState().setMergeStatus(tabId, event.result.ok ? 'merged' : 'conflict')
        break

      case 'sandbox_dirty_warning':
        useSandboxStore.getState().setPendingDirtyWarning({ tabId, runId: event.runId, dirty: event.dirty })
        break
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty`
Expected: 0 errors

---

## Task 8: UI Components — SandboxToggle + DirtyStateWarning

**Files:**
- Create: `src/renderer/components/SandboxToggle.tsx`
- Create: `src/renderer/components/DirtyStateWarning.tsx`
- Modify: `src/renderer/components/SettingsPopover.tsx`

- [ ] **Step 1: Write SandboxToggle.tsx**

```tsx
// src/renderer/components/SandboxToggle.tsx
import { GitBranch } from '@phosphor-icons/react'
import { motion } from 'framer-motion'
import { useColors } from '../theme'
import { useSandboxStore } from '../stores/sandboxStore'
import { useSessionStore } from '../stores/sessionStore'

export function SandboxToggle() {
  const colors = useColors()
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const tabState = useSandboxStore((s) => activeTabId ? s.getTabState(activeTabId) : null)
  const setEnabled = useSandboxStore((s) => s.setEnabled)

  if (!activeTabId) return null

  const enabled = tabState?.enabled ?? false

  return (
    <motion.button
      onClick={() => setEnabled(activeTabId, !enabled)}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
      style={{
        backgroundColor: enabled ? 'rgba(34, 197, 94, 0.12)' : colors.surfaceSecondary,
        border: `1px solid ${enabled ? 'rgba(34, 197, 94, 0.3)' : colors.containerBorder}`,
        color: enabled ? colors.statusComplete : colors.textSecondary,
      }}
      whileTap={{ scale: 0.97 }}
    >
      <GitBranch size={14} weight={enabled ? 'fill' : 'regular'} />
      Sandbox {enabled ? 'ON' : 'OFF'}
    </motion.button>
  )
}
```

- [ ] **Step 2: Write DirtyStateWarning.tsx**

```tsx
// src/renderer/components/DirtyStateWarning.tsx
import { Warning, SpinnerGap } from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { useColors } from '../theme'
import { useSandboxStore } from '../stores/sandboxStore'

export function DirtyStateWarning() {
  const colors = useColors()
  const warning = useSandboxStore((s) => s.pendingDirtyWarning)
  const dismiss = useSandboxStore((s) => s.setPendingDirtyWarning)
  const [stashing, setStashing] = useState(false)

  if (!warning) return null

  const handleStashAndRun = async () => {
    setStashing(true)
    try {
      await window.clui.sandboxAutoStash(
        '', // cwd will come from the tab's workingDirectory
        `CLUI auto-stash before run ${warning.runId}`,
      )
      dismiss(null)
    } catch {
      setStashing(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8, scaleY: 0.95 }}
        animate={{ opacity: 1, y: 0, scaleY: 1 }}
        exit={{ opacity: 0, y: -4, scaleY: 0.95 }}
        transition={{ duration: 0.2 }}
        className="mx-3 mb-2 rounded-xl overflow-hidden"
        style={{ border: `1px solid ${colors.accentBorder}` }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2 text-xs font-medium"
          style={{ backgroundColor: 'rgba(217, 119, 87, 0.08)', color: colors.accent }}
        >
          <Warning size={14} />
          Uncommitted changes detected
        </div>
        <div className="px-3 py-2" style={{ backgroundColor: colors.containerBg }}>
          <p className="text-xs mb-2" style={{ color: colors.textSecondary }}>
            {warning.dirty.summary} — {warning.dirty.unstaged.length + warning.dirty.untracked.length} files
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleStashAndRun}
              disabled={stashing}
              className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium"
              style={{ backgroundColor: colors.accentLight, color: colors.accent }}
            >
              {stashing && <SpinnerGap size={12} className="animate-spin" />}
              Stash & Run
            </button>
            <button
              onClick={() => dismiss(null)}
              className="px-3 py-1 rounded-md text-xs"
              style={{ backgroundColor: colors.surfaceHover, color: colors.textSecondary }}
            >
              Cancel
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
```

- [ ] **Step 3: Add SandboxToggle to SettingsPopover**

In `SettingsPopover.tsx`, import and render `SandboxToggle` in the settings rows section.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --pretty`
Expected: 0 errors

---

## Task 9: UI Components — SandboxRunSummary

**Files:**
- Create: `src/renderer/components/SandboxRunSummary.tsx`

- [ ] **Step 1: Write SandboxRunSummary.tsx**

```tsx
// src/renderer/components/SandboxRunSummary.tsx
import { GitMerge, ArrowClockwise, X, CaretDown, CaretRight, Check } from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { useColors } from '../theme'
import { useSandboxStore } from '../stores/sandboxStore'
import { useSessionStore } from '../stores/sessionStore'
import { useNotificationStore } from '../stores/notificationStore'
import type { DiffSummary, MergeResult } from '../../shared/sandbox-types'

export function SandboxRunSummary() {
  const colors = useColors()
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const tabState = useSandboxStore((s) => activeTabId ? s.getTabState(activeTabId) : null)
  const setMergeStatus = useSandboxStore((s) => s.setMergeStatus)
  const addToast = useNotificationStore((s) => s.addToast)

  const [filesExpanded, setFilesExpanded] = useState(false)
  const [merging, setMerging] = useState(false)
  const [reverting, setReverting] = useState(false)

  if (!activeTabId || !tabState?.pendingDiff || tabState.mergeStatus === 'idle') return null
  if (tabState.mergeStatus === 'merged' || tabState.mergeStatus === 'reverted') return null

  const diff = tabState.pendingDiff
  const wt = tabState.activeWorktree

  const handleMerge = async () => {
    if (!wt) return
    setMerging(true)
    try {
      const repoRoot = wt.path.replace(/[/\\].clui-sandboxes[/\\].*$/, '')
      const result: MergeResult = await window.clui.sandboxMerge(repoRoot, wt.branch, wt.baseBranch)
      if (result.ok) {
        setMergeStatus(activeTabId, 'merged')
        addToast({ type: 'success', title: `Merged ${diff.filesChanged} files`, duration: 3000 })
      } else {
        setMergeStatus(activeTabId, 'conflict')
        addToast({ type: 'error', title: `Conflict in ${result.conflicted.length} files`, duration: 6000 })
      }
    } catch {
      addToast({ type: 'error', title: 'Merge failed', duration: 4000 })
    }
    setMerging(false)
  }

  const handleRevert = async () => {
    if (!wt) return
    setReverting(true)
    try {
      await window.clui.sandboxRevert(wt.path, wt.baseBranch)
      setMergeStatus(activeTabId, 'reverted')
      addToast({ type: 'info', title: 'Changes discarded', duration: 3000 })
    } catch {
      addToast({ type: 'error', title: 'Revert failed', duration: 4000 })
    }
    setReverting(false)
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.985 }}
        transition={{ duration: 0.26, ease: [0.4, 0, 0.1, 1] }}
        className="mx-3 mb-3 rounded-2xl overflow-hidden no-drag"
        style={{
          backgroundColor: colors.containerBg,
          border: `1px solid ${colors.containerBorder}`,
          boxShadow: colors.cardShadow,
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: `1px solid ${colors.containerBorder}` }}
        >
          <div className="flex items-center gap-2">
            <Check size={14} style={{ color: colors.statusComplete }} />
            <span className="text-sm font-semibold" style={{ color: colors.textPrimary }}>
              Sandbox Run Complete
            </span>
          </div>
          <button onClick={() => setMergeStatus(activeTabId, 'idle')}>
            <X size={14} style={{ color: colors.textTertiary }} />
          </button>
        </div>

        {/* Diff Stats */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-4 text-xs">
            <span style={{ color: colors.statusComplete }}>+{diff.insertions}</span>
            <span style={{ color: colors.statusError }}>-{diff.deletions}</span>
            <span style={{ color: colors.textSecondary }}>{diff.filesChanged} files</span>
          </div>

          {/* File List (collapsible) */}
          <button
            onClick={() => setFilesExpanded(!filesExpanded)}
            className="flex items-center gap-1 mt-2 text-xs"
            style={{ color: colors.textSecondary }}
          >
            {filesExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
            {diff.filesChanged} files changed
          </button>

          <AnimatePresence>
            {filesExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {diff.files.map((f) => (
                    <div key={f.path} className="flex items-center gap-2 text-xs font-mono" style={{ color: colors.textSecondary }}>
                      <span style={{
                        color: f.status === 'A' ? colors.statusComplete
                          : f.status === 'D' ? colors.statusError
                          : colors.accent,
                        fontWeight: 600,
                        width: 12,
                      }}>
                        {f.status}
                      </span>
                      <span className="truncate">{f.path}</span>
                      <span className="ml-auto flex gap-2" style={{ color: colors.textTertiary }}>
                        <span style={{ color: colors.statusComplete }}>+{f.insertions}</span>
                        <span style={{ color: colors.statusError }}>-{f.deletions}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Action Buttons */}
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderTop: `1px solid ${colors.containerBorder}` }}
        >
          <button
            onClick={handleMerge}
            disabled={merging || reverting}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium"
            style={{ backgroundColor: colors.accent, color: '#fff' }}
          >
            <GitMerge size={14} />
            {merging ? 'Merging...' : 'Merge to Main'}
          </button>
          <button
            onClick={handleRevert}
            disabled={merging || reverting}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium"
            style={{ backgroundColor: colors.accentLight, color: colors.accent }}
          >
            <ArrowClockwise size={14} />
            {reverting ? 'Reverting...' : 'Discard'}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty`
Expected: 0 errors

---

## Task 10: UI Components — FileTreePanel + StashBrowser

**Files:**
- Create: `src/renderer/components/FileTreeNode.tsx`
- Create: `src/renderer/components/FileTreePanel.tsx`
- Create: `src/renderer/components/StashBrowser.tsx`

- [ ] **Step 1: Write FileTreeNode.tsx**

Recursive tree node component with expand/collapse. Uses `FolderOpen`, `Folder`, `FileText` from Phosphor. Calls `sandboxStore.loadFileTree()` on expand.

- [ ] **Step 2: Write FileTreePanel.tsx**

Right sidebar panel (280px wide, slide-in from right with Framer Motion `x: 280 → 0`). Header with search, close button. Renders `FileTreeNode` recursively.

- [ ] **Step 3: Write StashBrowser.tsx**

Elevated modal panel (z-30). Lists stashes with expand/collapse per stash. Expanded view shows file list + unified diff in monospace pre block. Action buttons: Apply, Delete.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --pretty`
Expected: 0 errors

---

## Task 11: Command Palette & Keyboard Shortcuts

**Files:**
- Modify: `src/shared/command-palette.ts`
- Modify: `src/shared/keyboard-shortcuts.ts`
- Modify: `src/renderer/components/CommandPalette.tsx`

- [ ] **Step 1: Add sandbox commands to command-palette.ts**

Add to the commands array in `buildCommands()` (or equivalent):

```typescript
{ id: 'sandbox-toggle', category: 'action', icon: 'GitBranch', label: 'Toggle Sandbox Mode', description: 'Run AI in isolated worktree' },
{ id: 'file-tree-toggle', category: 'action', icon: 'FolderOpen', label: 'Toggle File Tree', description: 'Browse project files' },
{ id: 'stash-browser', category: 'action', icon: 'FolderDashed', label: 'Browse Git Stashes', description: 'View and manage stashes' },
{ id: 'review-changes', category: 'action', icon: 'ArrowsLeftRight', label: 'Review Sandbox Changes', description: 'View diff from last run' },
{ id: 'clean-worktrees', category: 'action', icon: 'Trash', label: 'Clean Old Worktrees', description: 'Remove sandbox worktrees' },
```

- [ ] **Step 2: Add shortcut action IDs to keyboard-shortcuts.ts**

```typescript
| 'sandbox-toggle'
| 'file-tree-toggle'
| 'stash-browser'
| 'review-changes'
```

With default bindings:
- `sandbox-toggle`: `Ctrl+Alt+S` / `Cmd+Option+S`
- `file-tree-toggle`: `Ctrl+Alt+F` / `Cmd+Option+F`
- `stash-browser`: `Ctrl+Alt+H` / `Cmd+Option+H`
- `review-changes`: `Ctrl+Alt+R` / `Cmd+Option+R`

- [ ] **Step 3: Wire commands in CommandPalette.tsx**

In the command execution handler, add cases for the 5 new command IDs that call the appropriate sandboxStore actions.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --pretty`
Expected: 0 errors

---

## Task 12: Integration — Wire Components into App Layout

**Files:**
- Modify: Main app layout file (wherever ConversationView, InputBar, etc. are composed)

- [ ] **Step 1: Add DirtyStateWarning above InputBar**

Import and render `<DirtyStateWarning />` just before `<InputBar />` in the layout.

- [ ] **Step 2: Add SandboxRunSummary after ConversationView**

Import and render `<SandboxRunSummary />` between ConversationView and InputBar.

- [ ] **Step 3: Add FileTreePanel (conditionally rendered)**

Import and render `<FileTreePanel />` at the app root level (z-40, position fixed right).

- [ ] **Step 4: Add StashBrowser (conditionally rendered)**

Import and render `<StashBrowser />` at the app root level (z-30, elevated modal).

- [ ] **Step 5: Full build + test**

Run: `npm run build && npm run test`
Expected: Both pass with 0 errors

---

## Task 13: Final Verification & Cleanup

- [ ] **Step 1: Run full test suite**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 2: Run type check**

Run: `npm run build`
Expected: 0 errors

- [ ] **Step 3: Add .clui-sandboxes to .gitignore**

Ensure `.clui-sandboxes/` is in `.gitignore` so worktree directories are never committed.

- [ ] **Step 4: Commit all changes**

```bash
git add src/shared/sandbox-types.ts src/main/sandbox/ src/renderer/stores/sandboxStore.ts src/renderer/components/SandboxToggle.tsx src/renderer/components/DirtyStateWarning.tsx src/renderer/components/SandboxRunSummary.tsx src/renderer/components/FileTreePanel.tsx src/renderer/components/FileTreeNode.tsx src/renderer/components/StashBrowser.tsx
git add -u  # modified files
```

Single commit message: `SANDBOX-001: Add sandbox mode — worktree isolation, merge/revert, dirty detection, file tree, stash browser`
