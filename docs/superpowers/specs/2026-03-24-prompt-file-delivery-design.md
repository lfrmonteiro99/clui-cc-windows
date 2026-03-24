# Prompt File Delivery — Design Spec

## Problem

The combined system prompt (agent memory + smart context packet + CLUI hint) is passed inline via `--append-system-prompt <string>` as a CLI argument. The Claude Code CLI rejects prompts that exceed its internal argument size limit with a "Prompt is too long" error. The smart context packet alone can reach ~8000 chars (2000 token budget × ~4 chars/token), and when combined with agent memory and the CLUI hint, it exceeds the CLI's limit.

Note: Node.js `spawn()` uses `CreateProcessW` (32K char limit on Windows), so the OS limit is not the bottleneck — the error originates from the Claude Code CLI's own argument parsing.

## Solution

Write the combined system prompt to a temp file and use `--append-system-prompt-file <path>` instead. This flag is supported by Claude Code CLI and bypasses any argument length constraints.

## Design

### Directory & Naming

- **Directory:** `join(os.tmpdir(), 'clui-prompt-files')`
- **File pattern:** `{runId}.prompt.txt`
- **Permissions:** `mode: 0o700` for directory, `mode: 0o600` for files (matches `permission-server.ts` pattern). On Windows these are no-ops but correct for macOS (production platform).
- Follows existing CLUI temp conventions (`clui-hook-config`, `clui-screenshot-*`, `clui-paste-*`)

### Lifecycle (A+C pattern)

**Per-run (A):**
1. `startRun()` → `mkdirSync(dir, { recursive: true, mode: 0o700 })` → `writeFileSync(path, content, { encoding: 'utf-8', mode: 0o600 })`
2. `args.push('--append-system-prompt-file', path)` instead of inline string
3. `close`/`error` handlers → `cleanupPromptFile(handle.promptFilePath)`
4. Track the temp file path on `RunHandle` so cleanup knows what to delete

**Edge case — synchronous spawn failure:** If `spawn()` throws synchronously (e.g., bad binary path), neither `close` nor `error` fires. The orphaned file is caught by startup cleanup (C). This is acceptable given the rarity of this case.

**Edge case — duplicate runId:** ControlPlane guards against duplicate `requestId` values before reaching RunManager. No additional guard needed here.

**Startup cleanup (C):**
- Exported `cleanOrphanedPromptFiles()` function
- On app startup, reads directory with `readdirSync()` and deletes each file with `unlinkSync()` (preserves the directory itself)
- Called once from `index.ts` during initialization
- ENOENT errors (directory doesn't exist yet) → debug log. Other errors → warn log. No silent catches.

### WSL Considerations

When `options.runtime === 'wsl'`, the `wsl-spawner.ts` converts Windows drive paths (matching `/^[A-Za-z]:[/\\]/`) to `/mnt/<drive>/...` paths. A temp file at `C:\Users\...\Temp\clui-prompt-files\foo.prompt.txt` becomes `/mnt/c/Users/.../Temp/clui-prompt-files/foo.prompt.txt` inside WSL.

**Risk:** If the WSL distro cannot access the Windows filesystem via `/mnt/c/`, the file path is invalid inside WSL but the file write itself succeeded — so the inline fallback does NOT trigger.

**Mitigation:** For WSL runs, always use inline `--append-system-prompt` (the original behavior). The CLI arg length limit is less likely to be an issue inside WSL (Linux has a much higher limit). This keeps WSL path as a simple, reliable code path.

### Fallback

If `writeFileSync` fails (permissions, disk full), fall back to inline `--append-system-prompt <string>`. Log a warning. This ensures the app never fails to spawn a CLI process due to temp file issues.

### Changes

**`src/main/claude/run-manager.ts`:**
- Add `import { writeFileSync, unlinkSync, mkdirSync, readdirSync } from 'fs'`
- Add `import { tmpdir } from 'os'`
- Add `const PROMPT_FILE_DIR = join(tmpdir(), 'clui-prompt-files')`
- Add `promptFilePath: string | null` to `RunHandle`
- New helper: `writePromptFile(runId, content) → string | null` — writes temp file, returns path or null on failure
- New helper: `cleanupPromptFile(path)` — unlinkSync with try/catch + logging
- New export: `cleanOrphanedPromptFiles()` — iterates dir with readdirSync + unlinkSync per file
- Modify `startRun()`: write file → use `--append-system-prompt-file` or fallback to inline. For WSL runs, always use inline.
- Modify `close`/`error` handlers: call `cleanupPromptFile(handle.promptFilePath)`

**`src/main/index.ts`:**
- Import and call `cleanOrphanedPromptFiles()` during app startup

### What does NOT change

- `CLUI_SYSTEM_HINT` content — identical
- `combinedSystemPrompt` construction logic — identical
- Context memory budgets and tier trimming — identical
- `control-plane.ts` — no changes

### Testing (TDD)

Unit tests for:
1. `writePromptFile()` — writes file with correct content and returns path
2. `writePromptFile()` — file content matches input exactly (no encoding artifacts)
3. `writePromptFile()` — returns null on write failure (mock fs error)
4. `cleanupPromptFile()` — deletes existing file
5. `cleanupPromptFile()` — no-ops on missing file (ENOENT), logs debug
6. `cleanOrphanedPromptFiles()` — clears all files in directory
7. `cleanOrphanedPromptFiles()` — no-ops when directory doesn't exist
8. `startRun()` args — verify `--append-system-prompt-file` present (not inline `--append-system-prompt`)
9. Fallback path — verify `--append-system-prompt` used when file write fails
10. WSL path — verify inline `--append-system-prompt` used for WSL runs (never file)
