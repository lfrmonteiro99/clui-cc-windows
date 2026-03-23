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
  rawDiff: string
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

// ─── Sandbox Options (extends RunOptions) ───
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
