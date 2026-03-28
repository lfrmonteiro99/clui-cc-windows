/**
 * Cross-platform utilities for binary detection, PATH management,
 * and login shell PATH resolution.
 *
 * Replaces the duplicated Unix-only logic previously in:
 *  - process-manager.ts
 *  - run-manager.ts
 *  - pty-run-manager.ts
 *
 * All functions read process.platform at call time (not module load time)
 * so that tests can mock the platform per-test.
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, accessSync, constants } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import path from 'path'

function isWin(): boolean {
  return process.platform === 'win32'
}

function pathSep(): string {
  return isWin() ? ';' : ':'
}

/**
 * Find a binary by name using platform-appropriate lookup.
 *
 * - Windows: `where <name>` (returns first match)
 * - POSIX: tries `/bin/zsh -lc "whence -p <name>"`, then `/bin/bash -lc "which <name>"`
 *
 * Returns the full path or the bare name as fallback.
 */
export function findBinary(name: string): string {
  if (isWin()) {
    try {
      const result = execSync(`where ${name}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
      const lines = result.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      // On Windows, prefer .cmd/.exe over bare name (which may be a POSIX shell shim)
      const cmdOrExe = lines.find(l => /\.(cmd|exe)$/i.test(l))
      if (cmdOrExe) return cmdOrExe
      if (lines[0]) return lines[0]
    } catch { /* where command failed */ }
    return name
  }

  // POSIX: try login shells
  try {
    const result = execSync(`/bin/zsh -lc "whence -p ${name}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    if (result) return result
  } catch { /* zsh lookup failed */ }

  try {
    const result = execSync(`/bin/bash -lc "which ${name}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    if (result) return result
  } catch { /* bash lookup failed */ }

  try {
    const result = execSync(`/usr/bin/fish -lc "type -P ${name}"`, { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    if (result) return result
  } catch { console.warn('[platform] fish lookup failed') }

  return name
}

/**
 * Get the full login shell PATH.
 *
 * On macOS/Linux, Electron doesn't source ~/.zshrc so PATH is often incomplete.
 * On Windows, the system PATH is already complete — returns empty string.
 */
export function getLoginShellPath(): string {
  if (isWin()) return ''

  try {
    return execSync('/bin/zsh -lc "echo $PATH"', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
  } catch { /* zsh not available */ }

  try {
    return execSync('/bin/bash -lc "echo $PATH"', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
  } catch { /* bash not available */ }

  return ''
}

/**
 * Ensure the directory containing `binaryPath` is in `env.PATH`.
 *
 * Uses `path.dirname()` (cross-platform) instead of `lastIndexOf('/')`.
 * Uses the correct PATH separator per platform (`;` on Windows, `:` on POSIX).
 */
export function ensureBinDirInPath(binaryPath: string, env: NodeJS.ProcessEnv): void {
  // Use the platform-appropriate path module so Windows paths parse correctly
  // even when the host OS is different (e.g. tests running on Linux).
  const platformPath = isWin() ? path.win32 : path.posix
  const binDir = platformPath.dirname(binaryPath)

  // If binary is a bare name (no directory component), dirname returns '.'.
  // Don't prepend '.' to PATH.
  if (binDir === '.') return

  // On Windows, process.env may carry the path variable as 'Path' (not 'PATH').
  // Resolve the actual key to avoid creating a duplicate entry.
  const pathKey = resolvePathKey(env)

  const sep = pathSep()
  const currentPath = env[pathKey] || ''

  // Check if binDir is already in PATH
  if (currentPath) {
    const dirs = currentPath.split(sep)
    if (dirs.includes(binDir)) return
    env[pathKey] = `${binDir}${sep}${currentPath}`
  } else {
    env[pathKey] = binDir
  }
}

/**
 * Resolve the actual environment key for PATH.
 * On Windows, it can be 'Path', 'PATH', or 'path' — case varies.
 */
function resolvePathKey(env: NodeJS.ProcessEnv): string {
  if (isWin()) {
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === 'path') return key
    }
  }
  return 'PATH'
}

export function getClaudeLaunchPrefixArgs(): string[] {
  const scriptPath = process.env.CLUI_CLAUDE_NODE_SCRIPT?.trim()
  return scriptPath ? [scriptPath] : []
}

/**
 * Find the Claude Code CLI binary using platform-appropriate candidate
 * paths and shell lookups.
 *
 * Candidate paths differ per platform:
 * - macOS: /usr/local/bin, /opt/homebrew/bin, ~/.npm-global/bin
 * - Windows: %APPDATA%\npm, %LOCALAPPDATA%\Programs, %PROGRAMFILES%
 * - Both: ~/.npm-global/bin
 */
export function findClaudeBinary(): string {
  const override = process.env.CLUI_CLAUDE_BIN?.trim()
  if (override) {
    return override
  }

  const home = homedir()

  const candidates: string[] = isWin()
    ? [
        join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        join(home, 'AppData', 'Roaming', 'npm', 'claude'),
        join(home, '.npm-global', 'bin', 'claude.cmd'),
        join(home, '.npm-global', 'bin', 'claude'),
      ]
    : [
        '/usr/local/bin/claude',
        ...(process.platform === 'darwin' ? ['/opt/homebrew/bin/claude'] : []),
        join(home, '.npm-global/bin/claude'),
      ]

  // Add Linux-standard paths
  if (process.platform === 'linux') {
    candidates.push(
      '/usr/bin/claude',
      join(home, '.local/bin/claude'),
      '/snap/bin/claude',
    )
  }

  for (const c of candidates) {
    try {
      if (existsSync(c)) {
        // On POSIX, also check execute permission
        if (!isWin()) {
          accessSync(c, constants.X_OK)
        }
        return c
      }
    } catch { /* candidate not accessible */ }
  }

  // Fall back to PATH-based lookup
  return findBinary('claude')
}

export interface ClaudeEntryPoint {
  binary: string
  prefixArgs: string[]
}

/**
 * Resolve the Claude CLI entry point for spawning.
 *
 * On non-Windows: returns { binary: findClaudeBinary(), prefixArgs: getClaudeLaunchPrefixArgs() }
 *
 * On Windows: attempts to parse claude.cmd to find the underlying node_modules cli.js,
 * then returns { binary: 'node.exe', prefixArgs: ['/path/to/cli.js'] }.
 * This avoids shell: true which causes cmd.exe escaping problems.
 *
 * Falls back to the standard binary + prefix args if resolution fails.
 */
export function resolveClaudeEntryPoint(): ClaudeEntryPoint {
  const fallback: ClaudeEntryPoint = {
    binary: findClaudeBinary(),
    prefixArgs: getClaudeLaunchPrefixArgs(),
  }

  if (!isWin()) {
    return fallback
  }

  // On Windows, try to resolve claude.cmd → node.exe + cli.js
  const resolved = _resolveWindowsCmdToNodeCliJs(fallback.binary)
  return resolved ?? fallback
}

/**
 * Given a claude binary path (possibly a .cmd), try to parse the .cmd wrapper
 * and extract the real cli.js path so we can spawn node.exe directly.
 *
 * Returns null if resolution fails at any step.
 */
function _resolveWindowsCmdToNodeCliJs(claudeBinary: string): ClaudeEntryPoint | null {
  // Build candidate .cmd paths to check
  const candidates: string[] = []

  // If findClaudeBinary already returned a .cmd, use it directly
  if (/\.cmd$/i.test(claudeBinary)) {
    candidates.push(claudeBinary)
  } else {
    // Try appending .cmd to the found binary
    candidates.push(claudeBinary + '.cmd')
  }

  // Also try the well-known %APPDATA%\npm location
  const appDataNpmCmd = join(homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd')
  if (!candidates.includes(appDataNpmCmd)) {
    candidates.push(appDataNpmCmd)
  }

  for (const cmdPath of candidates) {
    if (!existsSync(cmdPath)) continue

    try {
      const content = readFileSync(cmdPath, 'utf-8')

      // Match the real cli.js path inside the .cmd wrapper.
      // The pattern looks for: node_modules\@anthropic-ai\claude-code\cli.js
      // or with forward slashes. We explicitly avoid matching node_modules\.bin\claude shims.
      const match = content.match(/node_modules[\\/]@anthropic-ai[\\/]claude-code[\\/]cli\.js/)
      if (!match) continue

      // Extract the relative path from the match
      const relativePath = match[0]
      const cmdDir = dirname(cmdPath)
      const cliJsPath = join(cmdDir, relativePath)

      // Verify cli.js actually exists on disk
      if (!existsSync(cliJsPath)) continue

      return {
        binary: 'node.exe',
        prefixArgs: [cliJsPath],
      }
    } catch {
      // readFileSync failed or other error — try next candidate
      continue
    }
  }

  return null
}
