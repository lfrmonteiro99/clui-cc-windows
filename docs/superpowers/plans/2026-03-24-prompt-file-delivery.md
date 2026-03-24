# Prompt File Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inline `--append-system-prompt` CLI arg with `--append-system-prompt-file` temp files to avoid Claude CLI prompt length errors.

**Architecture:** Extract four pure functions (`writePromptFile`, `cleanupPromptFile`, `cleanOrphanedPromptFiles`, `buildPromptArgs`) into a new `prompt-file.ts` module. Modify `RunManager.startRun()` to use file delivery with inline fallback. Add `promptFilePath` to `RunHandle`. WSL runs always use inline (no file). Startup cleanup in `index.ts`.

**Spec deviation:** The spec places helpers inside `run-manager.ts`. This plan extracts them to `prompt-file.ts` for independent testability — `run-manager.ts` depends on `spawn()` which makes unit testing the prompt logic impossible without mocking the entire process lifecycle. Separate module = pure functions = trivially testable.

**Tech Stack:** Node.js `fs` (sync), Vitest, existing CLUI patterns.

**Spec:** `docs/superpowers/specs/2026-03-24-prompt-file-delivery-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/main/claude/prompt-file.ts` | Four exports: `writePromptFile`, `cleanupPromptFile`, `cleanOrphanedPromptFiles`, `buildPromptArgs` |
| Create | `src/main/claude/__tests__/prompt-file.test.ts` | 13 unit tests covering all paths including mocked fs failures |
| Modify | `src/main/claude/run-manager.ts:50-66` | Add `promptFilePath` to `RunHandle` |
| Modify | `src/main/claude/run-manager.ts:157-162` | Switch to file delivery with WSL/fallback branching |
| Modify | `src/main/claude/run-manager.ts:266-295` | Add cleanup calls in `close`/`error` handlers |
| Modify | `src/main/index.ts:1285-1300` | Call `cleanOrphanedPromptFiles()` on startup |

---

### Task 1: Write failing tests for `writePromptFile`

**Files:**
- Create: `src/main/claude/__tests__/prompt-file.test.ts`

- [ ] **Step 1: Create test file with 3 test cases**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { writePromptFile, PROMPT_FILE_DIR } from '../prompt-file'

describe('writePromptFile', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(PROMPT_FILE_DIR, { recursive: true, force: true })
  })

  it('writes file with correct content and returns path', () => {
    const content = 'You are inside CLUI.\n\nContext memory here.'
    const result = writePromptFile('run-001', content)

    expect(result).toBe(join(PROMPT_FILE_DIR, 'run-001.prompt.txt'))
    expect(existsSync(result!)).toBe(true)
    expect(readFileSync(result!, 'utf-8')).toBe(content)
  })

  it('file content matches input exactly — no encoding artifacts', () => {
    const content = 'Émojis: 🧠 Ação — "quotes" <tags> \n\ttabs'
    const result = writePromptFile('run-unicode', content)

    expect(readFileSync(result!, 'utf-8')).toBe(content)
  })

  it('returns null when writeFileSync throws', () => {
    const fs = require('fs')
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device')
    })

    const result = writePromptFile('run-fail', 'content')
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/claude/__tests__/prompt-file.test.ts`
Expected: FAIL — `Cannot find module '../prompt-file'`

---

### Task 2: Implement `writePromptFile`

**Files:**
- Create: `src/main/claude/prompt-file.ts`

- [ ] **Step 1: Create the module with `writePromptFile`**

```ts
import { writeFileSync, unlinkSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { log as _log } from '../logger'

export const PROMPT_FILE_DIR = join(tmpdir(), 'clui-prompt-files')

function log(msg: string): void {
  _log('PromptFile', msg)
}

/**
 * Write system prompt content to a temp file for --append-system-prompt-file.
 * Returns the file path on success, or null on failure (caller should fallback to inline).
 */
export function writePromptFile(runId: string, content: string): string | null {
  const filePath = join(PROMPT_FILE_DIR, `${runId}.prompt.txt`)
  try {
    mkdirSync(PROMPT_FILE_DIR, { recursive: true, mode: 0o700 })
    writeFileSync(filePath, content, { encoding: 'utf-8', mode: 0o600 })
    return filePath
  } catch (err) {
    log(`Failed to write prompt file for ${runId}: ${err}`)
    return null
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/main/claude/__tests__/prompt-file.test.ts`
Expected: PASS (3 tests)

---

### Task 3: Write failing tests for `cleanupPromptFile` and `cleanOrphanedPromptFiles`

**Files:**
- Modify: `src/main/claude/__tests__/prompt-file.test.ts`

- [ ] **Step 1: Add imports and test cases**

Add `cleanupPromptFile` and `cleanOrphanedPromptFiles` to the existing import from `'../prompt-file'` at the top of the file. Add `readdirSync` to the existing `fs` import. Then add these test blocks after the `writePromptFile` describe block:

```ts
describe('cleanupPromptFile', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(PROMPT_FILE_DIR, { recursive: true, force: true })
  })

  it('deletes an existing file', () => {
    const path = writePromptFile('run-cleanup', 'test content')!
    expect(existsSync(path)).toBe(true)

    cleanupPromptFile(path)
    expect(existsSync(path)).toBe(false)
  })

  it('no-ops on missing file without throwing', () => {
    const fakePath = join(PROMPT_FILE_DIR, 'nonexistent.prompt.txt')
    expect(() => cleanupPromptFile(fakePath)).not.toThrow()
  })

  it('no-ops when path is null', () => {
    expect(() => cleanupPromptFile(null)).not.toThrow()
  })
})

describe('cleanOrphanedPromptFiles', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(PROMPT_FILE_DIR, { recursive: true, force: true })
  })

  it('clears all .prompt.txt files in directory', () => {
    writePromptFile('orphan-1', 'content 1')
    writePromptFile('orphan-2', 'content 2')
    writePromptFile('orphan-3', 'content 3')

    expect(readdirSync(PROMPT_FILE_DIR)).toHaveLength(3)

    cleanOrphanedPromptFiles()
    expect(readdirSync(PROMPT_FILE_DIR)).toHaveLength(0)
    // Directory itself still exists
    expect(existsSync(PROMPT_FILE_DIR)).toBe(true)
  })

  it('no-ops when directory does not exist', () => {
    expect(() => cleanOrphanedPromptFiles()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `npx vitest run src/main/claude/__tests__/prompt-file.test.ts`
Expected: FAIL — `cleanupPromptFile` and `cleanOrphanedPromptFiles` not exported from `../prompt-file`

---

### Task 4: Implement `cleanupPromptFile` and `cleanOrphanedPromptFiles`

**Files:**
- Modify: `src/main/claude/prompt-file.ts`

- [ ] **Step 1: Add both functions to the module**

Append to `prompt-file.ts`:

```ts
/**
 * Delete a prompt temp file. No-ops if path is null or file doesn't exist.
 */
export function cleanupPromptFile(filePath: string | null): void {
  if (!filePath) return
  try {
    unlinkSync(filePath)
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      log(`Failed to clean up prompt file ${filePath}: ${err}`)
    }
  }
}

/**
 * Remove all orphaned prompt files from previous app runs.
 * Called once on app startup. Only deletes .prompt.txt files. Preserves the directory itself.
 */
export function cleanOrphanedPromptFiles(): void {
  try {
    const files = readdirSync(PROMPT_FILE_DIR)
    let cleaned = 0
    for (const file of files) {
      if (!file.endsWith('.prompt.txt')) continue
      try {
        unlinkSync(join(PROMPT_FILE_DIR, file))
        cleaned++
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          log(`Failed to remove orphaned prompt file ${file}: ${err}`)
        }
      }
    }
    if (cleaned > 0) {
      log(`Cleaned ${cleaned} orphaned prompt file(s)`)
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      log(`Failed to read prompt file directory: ${err}`)
    }
  }
}
```

- [ ] **Step 2: Run tests to verify all pass**

Run: `npx vitest run src/main/claude/__tests__/prompt-file.test.ts`
Expected: PASS (8 tests)

---

### Task 5: Write failing tests for `buildPromptArgs`

**Files:**
- Modify: `src/main/claude/__tests__/prompt-file.test.ts`

- [ ] **Step 1: Add buildPromptArgs to the existing import and add test block**

Add `buildPromptArgs` to the existing import from `'../prompt-file'` at the top of the file. Then add this test block after the `cleanOrphanedPromptFiles` describe block:

```ts
describe('buildPromptArgs', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(PROMPT_FILE_DIR, { recursive: true, force: true })
  })

  it('returns --append-system-prompt-file for native runs', () => {
    const result = buildPromptArgs('run-native', 'system prompt content', false)

    expect(result.args).toEqual(['--append-system-prompt-file', result.filePath!])
    expect(result.filePath).toBe(join(PROMPT_FILE_DIR, 'run-native.prompt.txt'))
    expect(existsSync(result.filePath!)).toBe(true)
  })

  it('returns --append-system-prompt for WSL runs (always inline)', () => {
    const result = buildPromptArgs('run-wsl', 'system prompt content', true)

    expect(result.args).toEqual(['--append-system-prompt', 'system prompt content'])
    expect(result.filePath).toBeNull()
  })

  it('falls back to inline --append-system-prompt when file write fails', () => {
    const fs = require('fs')
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied')
    })

    const result = buildPromptArgs('run-fallback', 'prompt content', false)

    expect(result.args).toEqual(['--append-system-prompt', 'prompt content'])
    expect(result.filePath).toBeNull()
  })

  it('returns empty args and null filePath when content is empty', () => {
    const result = buildPromptArgs('run-empty', '', false)

    expect(result.args).toEqual([])
    expect(result.filePath).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `npx vitest run src/main/claude/__tests__/prompt-file.test.ts`
Expected: FAIL — `buildPromptArgs` not exported from `../prompt-file`

---

### Task 6: Implement `buildPromptArgs`

**Files:**
- Modify: `src/main/claude/prompt-file.ts`

- [ ] **Step 1: Add `buildPromptArgs` and its interface to the module**

Append to `prompt-file.ts`:

```ts
export interface PromptArgsResult {
  args: string[]
  filePath: string | null
}

/**
 * Build CLI args for system prompt delivery.
 * - Native runs: write temp file, use --append-system-prompt-file
 * - WSL runs: always inline --append-system-prompt (avoids path translation issues)
 * - Fallback: if file write fails, use inline --append-system-prompt
 * - Empty content: no args
 */
export function buildPromptArgs(runId: string, content: string, isWsl: boolean): PromptArgsResult {
  if (!content) {
    return { args: [], filePath: null }
  }

  if (isWsl) {
    return { args: ['--append-system-prompt', content], filePath: null }
  }

  const filePath = writePromptFile(runId, content)
  if (filePath) {
    return { args: ['--append-system-prompt-file', filePath], filePath }
  }

  // Fallback: file write failed, use inline
  log(`Falling back to inline --append-system-prompt for ${runId}`)
  return { args: ['--append-system-prompt', content], filePath: null }
}
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run src/main/claude/__tests__/prompt-file.test.ts`
Expected: PASS (12 tests — but the mocked `writeFileSync` test for `writePromptFile` may need adjustment since `vi.spyOn(require('fs'), ...)` behaviour depends on module system. If tests fail, switch to `vi.spyOn(await import('fs'), 'writeFileSync')` or use `vi.mock('fs', ...)` at module level. Debug and fix before proceeding.)

---

### Task 7: Wire into `RunManager` — modify `run-manager.ts`

**Files:**
- Modify: `src/main/claude/run-manager.ts:9` (add import)
- Modify: `src/main/claude/run-manager.ts:65` (add field to RunHandle)
- Modify: `src/main/claude/run-manager.ts:157-162` (replace prompt delivery)
- Modify: `src/main/claude/run-manager.ts:198` (init promptFilePath on handle, after `permissionDenials: [],`)
- Modify: `src/main/claude/run-manager.ts:278` (cleanup in close handler, after `this.emit('exit', ...)`)
- Modify: `src/main/claude/run-manager.ts:293` (cleanup in error handler, after `this.emit('error', ...)`)

- [ ] **Step 1: Add import**

At `run-manager.ts:9` (after the `CircularBuffer` import), add:

```ts
import { buildPromptArgs, cleanupPromptFile } from './prompt-file'
```

- [ ] **Step 2: Add `promptFilePath` to `RunHandle` interface**

At `run-manager.ts:65` (after `permissionDenials`), add:

```ts
  /** Path to temp system prompt file (null if using inline arg or WSL) */
  promptFilePath: string | null
```

- [ ] **Step 3: Replace inline prompt delivery with `buildPromptArgs`**

Replace lines 157-162 (the block starting with `// Combine CLUI hint`):

Old:
```ts
    // Combine CLUI hint with any existing system prompt (memory packet, agent context)
    // Uses --append-system-prompt (additive) so it doesn't replace Claude's base prompt.
    const combinedSystemPrompt = [options.systemPrompt, CLUI_SYSTEM_HINT].filter(Boolean).join('\n\n')
    if (combinedSystemPrompt) {
      args.push('--append-system-prompt', combinedSystemPrompt)
    }
```

New:
```ts
    // Combine CLUI hint with any existing system prompt (memory packet, agent context).
    // Delivered via temp file (--append-system-prompt-file) to avoid CLI arg length limits.
    // WSL runs use inline --append-system-prompt to avoid path translation issues.
    const combinedSystemPrompt = [options.systemPrompt, CLUI_SYSTEM_HINT].filter(Boolean).join('\n\n')
    const isWsl = options.runtime === 'wsl' && !!options.wslDistro
    const promptResult = buildPromptArgs(requestId, combinedSystemPrompt, isWsl)
    args.push(...promptResult.args)
```

- [ ] **Step 4: Initialize `promptFilePath` on handle**

At the handle object literal (~line 198), after `permissionDenials: [],` add:

```ts
      promptFilePath: promptResult.filePath,
```

- [ ] **Step 5: Add cleanup to `close` handler**

In the `close` handler, after `this.emit('exit', requestId, code, signal, handle.sessionId)` (line ~278), add:

```ts
      cleanupPromptFile(handle.promptFilePath)
```

- [ ] **Step 6: Add cleanup to `error` handler**

In the `error` handler, after `this.emit('error', requestId, err)` (line ~293), add:

```ts
      cleanupPromptFile(handle.promptFilePath)
```

- [ ] **Step 7: Run build to verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

---

### Task 8: Wire startup cleanup into `index.ts`

**Files:**
- Modify: `src/main/index.ts` (imports near top, call at line ~1286)

- [ ] **Step 1: Add import**

Add with the other claude-related imports near the top of `index.ts`:

```ts
import { cleanOrphanedPromptFiles } from './claude/prompt-file'
```

- [ ] **Step 2: Call cleanup in `app.whenReady()`**

At `index.ts:1286` (inside `app.whenReady().then(() => {`), before the `agentMemory = new AgentMemory(...)` line, add:

```ts
  // Clean up prompt temp files from previous runs (handles crashes that skip per-run cleanup)
  cleanOrphanedPromptFiles()
```

- [ ] **Step 3: Run build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

---

### Task 9: Commit

- [ ] **Step 1: Stage and commit all changes**

```bash
git add src/main/claude/prompt-file.ts src/main/claude/__tests__/prompt-file.test.ts src/main/claude/run-manager.ts src/main/index.ts
git commit -m "CLUI-001: Switch to --append-system-prompt-file for prompt delivery

Write combined system prompt to temp file instead of passing inline via
--append-system-prompt. Avoids Claude CLI arg length errors.

- New module: prompt-file.ts (writePromptFile, cleanupPromptFile, buildPromptArgs)
- WSL runs always use inline (avoids path translation issues)
- Fallback to inline if temp file write fails
- Startup cleanup of orphaned .prompt.txt files from previous crashes
- 12 unit tests covering all paths including mocked fs failures"
```
