import { writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'fs'
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
