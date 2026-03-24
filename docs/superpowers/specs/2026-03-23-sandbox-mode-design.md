# Sandbox Mode — Design Specification

**Date:** 2026-03-23
**Status:** Draft
**Scope:** Git Worktree Isolation, Post-Run Merge/Revert, Dirty State Detection, File Tree Explorer, Stash Integration

---

## 1. Overview

Sandbox Mode is a safety layer over the existing run flow. When enabled, AI runs execute in isolated git worktrees — the user's working directory is never touched. After a run, the user reviews a diff summary and decides to merge or revert.

### Features

| # | Feature | Entry Point | UI Pattern |
|---|---------|-------------|------------|
| 1 | Sandbox Toggle | SettingsPopover + Command Palette | Inline toggle |
| 2 | Dirty State Warning | Auto-detect before runs | Card above InputBar |
| 3 | Post-Run Summary + Merge/Revert | Auto after sandboxed run | Elevated modal (z-32) |
| 4 | File Tree Explorer | Command Palette + shortcut | Right sidebar (280px) |
| 5 | Stash Browser | Command Palette + shortcut | Elevated modal (z-30) |

---

## 2. Architecture

### New Files

```
src/main/sandbox/
├── worktree-manager.ts      # Create/remove worktrees, track handles
├── git-diff-engine.ts       # Diff generation, merge, revert
├── dirty-state-detector.ts  # Pre-run dirty check, auto-stash
├── file-tree-explorer.ts    # Directory listing with git status
├── stash-manager.ts         # Stash list, diff, metadata
└── index.ts                 # Module exports

src/shared/
└── sandbox-types.ts         # All sandbox types (shared main↔renderer)

src/renderer/
├── stores/sandboxStore.ts   # Zustand store for sandbox state
└── components/
    ├── SandboxModeToggle.tsx
    ├── DirtyStateWarning.tsx
    ├── SandboxRunSummary.tsx
    ├── FileTreePanel.tsx
    ├── FileTreeNode.tsx
    └── StashBrowser.tsx
```

### Modified Files

| File | Changes |
|------|---------|
| `src/shared/types.ts` | New IPC channels, sandbox NormalizedEvent types, TabState.sandboxState |
| `src/main/index.ts` | Register 9 new IPC handlers, init sandbox modules |
| `src/main/claude/control-plane.ts` | Pre-run dirty check, worktree creation, post-run diff, cleanup on tab close |
| `src/preload/index.ts` | Expose 9 new IPC methods on window.clui |
| `src/renderer/stores/sessionStore.impl.ts` | Handle sandbox_* events |
| `src/shared/command-palette.ts` | 5 new commands |
| `src/shared/keyboard-shortcuts.ts` | 4 new shortcuts |

### IPC Contract

| Channel | Direction | Request | Response |
|---------|-----------|---------|----------|
| `SANDBOX_CHECK_DIRTY` | invoke | `cwd: string` | `DirtyState` |
| `SANDBOX_GET_DIFF` | invoke | `runId, cwd, baseBranch` | `DiffSummary` |
| `SANDBOX_MERGE` | invoke | `runId, cwd, targetBranch` | `MergeResult` |
| `SANDBOX_REVERT` | invoke | `runId, cwd, baseBranch` | `{ ok: boolean }` |
| `SANDBOX_AUTO_STASH` | invoke | `cwd, message` | `{ ok, stashRef }` |
| `SANDBOX_LIST_FILES` | invoke | `cwd, relativePath?` | `DirectoryListing` |
| `SANDBOX_LIST_STASHES` | invoke | `cwd` | `StashEntry[]` |
| `SANDBOX_GET_STASH_DIFF` | invoke | `cwd, index, file?` | `string` |
| `SANDBOX_WORKTREE_STATUS` | invoke | `runId` | `{ exists, path?, branch? }` |

### Broadcast Events (via NORMALIZED_EVENT)

```typescript
{ type: 'sandbox_worktree_created', runId, worktreePath, branch }
{ type: 'sandbox_diff_generated', runId, diffSummary: DiffSummary }
{ type: 'sandbox_merge_completed', runId, result: MergeResult }
{ type: 'sandbox_dirty_warning', runId, dirtyState: DirtyState }
```

---

## 3. Data Flow

### Sandboxed Run (end-to-end)

```
User submits prompt (sandbox ON)
  → ControlPlane._dispatch()
  → DirtyStateDetector.checkDirtyState() → emit warning if dirty
  → WorktreeManager.createWorktree() → emit sandbox_worktree_created
  → RunManager.spawn(claude -p --cwd <worktree>)
  → Run completes (code=0)
  → GitDiffEngine.getDiff() → emit sandbox_diff_generated
  → Renderer shows SandboxRunSummary
  → User clicks [Merge] → IPC.SANDBOX_MERGE → GitDiffEngine.merge()
  → emit sandbox_merge_completed → Renderer shows result
  → WorktreeManager.removeWorktree() (cleanup)
```

### Git Commands

| Operation | Command |
|-----------|---------|
| Create worktree | `git worktree add <path>/.clui/worktrees/<uuid> -b clui-run-<uuid>` |
| Remove worktree | `git worktree remove <path>` + `git branch -D clui-run-<uuid>` |
| Diff | `git diff --numstat main...clui-run-<uuid>` |
| Full diff | `git diff main...clui-run-<uuid>` (truncate 100KB) |
| Merge | `git merge --no-ff clui-run-<uuid> -m "Merge sandbox run"` |
| Revert | `git reset --hard main` (in worktree) |
| Dirty check | `git status --porcelain` |
| Auto-stash | `git stash push -m "CLUI auto-stash <uuid>"` |
| Stash list | `git stash list --format='%h %s'` |
| Stash diff | `git stash show -p stash@{N}` |
| Repo guard | Check for `.git/MERGE_HEAD`, `.git/rebase-merge` |

---

## 4. Visual Design

### 4.1 Sandbox Toggle (SettingsPopover)

- **Off:** `surfaceSecondary` bg, `containerBorder`, muted text
- **On:** Green tint `rgba(34,197,94,0.15)`, green border, `statusComplete` text
- **Icon:** `<GitBranch size={14} />`
- **Animation:** spring (stiffness 500, damping 30)

### 4.2 Dirty State Warning

- **Placement:** Above InputBar, full width
- **Pattern:** PermissionCard-like card
- **Header:** Orange `rgba(217,119,87,0.08)`, `<Warning size={14} />`
- **Body:** File count, branch name
- **Buttons:** "Stash & Run" (accent), "Run Anyway" (secondary), "Cancel" (tertiary)
- **Animation:** `y: -8 → 0, scaleY: 0.95 → 1` (200ms)

### 4.3 Post-Run Summary (SandboxRunSummary)

- **Placement:** Elevated modal, centered, z-32
- **Pattern:** glass-surface, borderRadius 24
- **Sections:**
  1. Diff stats: `+X` (green) / `-Y` (red) / `Z files` (neutral)
  2. Worktree badge: `<GitBranch />` + path
  3. File list: collapsible, with M/A/D indicators
- **Buttons:** "Merge to Main" (primary), "Revert" (secondary), Close (tertiary)
- **Animation:** `y: 14 → 0, scale: 0.98 → 1` (260ms)

### 4.4 File Tree Explorer

- **Placement:** Right sidebar, 280px, slide-in from right
- **Header:** Search input + breadcrumb
- **Tree:** Recursive nodes with `<FolderOpen />` / `<FileText />`, git status badges
- **Interaction:** Click → FilePeekPanel, right-click → context menu
- **Animation:** `x: 280 → 0` (260ms)

### 4.5 Stash Browser

- **Placement:** Elevated modal, z-30
- **Pattern:** Marketplace-like panel
- **List:** Collapsible rows with stash message, timestamp, file count
- **Expanded:** Unified diff per stash, file list
- **Buttons:** "Apply" (primary), "View Diff" (secondary), "Delete" (danger)
- **Animation:** `y: 14 → 0, scale: 0.98 → 1` (260ms)

### Z-Index Hierarchy

```
40 — FileTreePanel (sidebar)
35 — PermissionWizard
32 — SandboxRunSummary
31 — FilePeekPanel
30 — StashBrowser / Marketplace
20 — Main chat
15 — InputBar
```

---

## 5. User Flows

### Flow 1: "I want to safely run AI"
1. Open Command Palette → "Enable Sandbox Mode" (2 clicks)
2. Submit prompt normally
3. Run executes in isolated worktree (transparent to user)
4. On completion → SandboxRunSummary appears automatically

### Flow 2: "AI finished, review changes"
1. SandboxRunSummary shows diff stats
2. Click file in list → inline diff preview
3. Click "Merge to Main" → confirmation if >5 files → merge
4. Success toast + optional undo (1 min window)

### Flow 3: "I have uncommitted changes"
1. Submit prompt → DirtyStateWarning appears
2. Options: "Stash & Run" (1 click + auto-run) | "Run Anyway" | "Cancel"
3. If sandbox enabled: warning doesn't show (worktree isolates changes)

### Flow 4: "Browse project files"
1. Cmd+Alt+F or Command Palette → "File Tree"
2. Sidebar slides in from right
3. Navigate tree, click file to peek
4. Drag file to InputBar → attaches to prompt

### Flow 5: "Check stashes"
1. Cmd+Alt+H or Command Palette → "Browse Stashes"
2. Modal shows stash list with timestamps
3. Expand stash → see files + diff
4. "Apply" / "Delete" with confirmation

---

## 6. Keyboard Shortcuts

| Action | Windows | macOS |
|--------|---------|-------|
| Toggle Sandbox | `Ctrl+Alt+S` | `Cmd+Option+S` |
| File Tree | `Ctrl+Alt+F` | `Cmd+Option+F` |
| Stash Browser | `Ctrl+Alt+H` | `Cmd+Option+H` |
| Review Changes | `Ctrl+Alt+R` | `Cmd+Option+R` |

---

## 7. Error Handling

| Scenario | Response |
|----------|----------|
| Not a git repo | Error toast, fallback to normal run |
| Worktree creation fails | Error toast, fallback to normal run |
| Merge conflict | Conflict modal with paths, offer resolve/abort |
| Dirty check timeout (>10s) | Skip with warning, proceed |
| Diff too large (>100KB) | Truncate, show "...truncated" |
| Repo in merge/rebase state | Reject with error modal |
| Tab close with pending worktree | Auto-cleanup (async, non-blocking) |

---

## 8. Types

```typescript
interface DirtyState {
  isDirty: boolean
  untracked: string[]
  unstaged: string[]
  stashed: number
  summary: string
}

interface DiffSummary {
  stat: { filesChanged: number; insertions: number; deletions: number }
  files: Array<{ path: string; status: 'M' | 'A' | 'D' | 'R'; insertions: number; deletions: number }>
  diff: string // truncated at 100KB
}

interface MergeResult {
  ok: boolean
  conflicted: string[]
  merged: string[]
  message?: string
}

interface WorktreeHandle {
  path: string
  branch: string
  runId: string
  createdAt: number
}

interface StashEntry {
  index: number
  ref: string
  message: string
  timestamp: number
  fileCount: number
}

interface FileTreeEntry {
  path: string
  type: 'file' | 'directory' | 'symlink'
  size?: number
  gitStatus?: 'M' | 'A' | 'D' | '?'
  isIgnored: boolean
}

interface DirectoryListing {
  path: string
  entries: FileTreeEntry[]
  totalSize: number
  truncated: boolean
}
```

---

## 9. State Management

### sandboxStore (Zustand)

```typescript
interface SandboxState {
  enabled: boolean
  runStates: Map<string, { worktree?: WorktreeHandle; diff?: DiffSummary; mergeStatus: string }>
  fileTreeOpen: boolean
  fileTreeEntries: FileTreeEntry[]
  stashBrowserOpen: boolean
  stashList: StashEntry[]
  // actions
  setEnabled(v: boolean): void
  checkDirty(cwd: string): Promise<DirtyState>
  merge(runId: string, cwd: string, branch: string): Promise<MergeResult>
  revert(runId: string, cwd: string, branch: string): Promise<void>
  loadFileTree(cwd: string, path?: string): Promise<void>
  loadStashes(cwd: string): Promise<void>
}
```

---

## 10. Command Palette Additions

| ID | Label | Icon | Category |
|----|-------|------|----------|
| `sandbox-toggle` | Toggle Sandbox Mode | GitBranch | action |
| `file-tree-toggle` | Toggle File Tree | FolderOpen | view |
| `stash-browser` | Browse Git Stashes | FolderDashed | action |
| `review-changes` | Review Sandbox Changes | ArrowsLeftRight | action |
| `clean-worktrees` | Clean Old Worktrees | Trash | action |

---

## 11. Colors (No New Tokens)

- **Active/Safe:** `colors.statusComplete` (green)
- **Warning/Dirty:** `colors.accent` (orange)
- **Error/Conflict:** `colors.statusError` (red)
- **Badge/Subtle:** `colors.accentLight`
- **All via `useColors()` hook** — no hardcoded values
