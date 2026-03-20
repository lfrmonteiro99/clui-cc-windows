/**
 * WSL detection utilities for discovering and interacting with
 * Windows Subsystem for Linux distributions.
 *
 * All functions check process.platform at call time (not module load)
 * so tests can mock the platform per-test.
 */

import { execSync, execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { log as _log } from '../logger'

function log(msg: string): void {
  _log('WslDetection', msg)
}

export interface WslDistro {
  name: string
  isDefault: boolean
  state: 'Running' | 'Stopped' | 'Installing'
  version: 1 | 2
}

export type RuntimeType = 'native' | 'wsl'

const WSL_EXEC_TIMEOUT = 10_000

/**
 * Check whether WSL is available on this machine.
 * Uses `wsl.exe --list --quiet` (not `--status` which is unreliable on older builds).
 * Only meaningful on win32.
 */
export function isWslAvailable(): boolean {
  if (process.platform !== 'win32') return false

  try {
    const result = execSync('wsl.exe --list --quiet', {
      timeout: WSL_EXEC_TIMEOUT,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    // wsl.exe outputs UTF-16LE; convert to string and check for content
    const text = result.toString('utf16le').replace(/\0/g, '').trim()
    return text.length > 0
  } catch {
    return false
  }
}

/**
 * List installed WSL distributions.
 * Parses `wsl.exe --list --verbose` output, which is UTF-16LE encoded (often with BOM).
 * Filters out docker-desktop* distros.
 */
export function listWslDistros(): WslDistro[] {
  if (process.platform !== 'win32') return []

  try {
    // Do NOT pass encoding — returns Buffer so we can decode UTF-16LE ourselves
    const rawBuf = execSync('wsl.exe --list --verbose', {
      timeout: WSL_EXEC_TIMEOUT,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }) as Buffer

    const text = rawBuf.toString('utf16le')
    // Strip BOM if present
    const cleaned = text.replace(/^\uFEFF/, '').replace(/\0/g, '')
    const lines = cleaned.split(/\r?\n/).filter(l => l.trim())

    // First line is the header; skip it
    const distros: WslDistro[] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      const parsed = parseVerboseLine(line)
      if (!parsed) continue
      // Filter out docker-desktop distros
      if (parsed.name.toLowerCase().startsWith('docker-desktop')) continue
      distros.push(parsed)
    }

    return distros
  } catch (err) {
    log(`listWslDistros failed: ${err}`)
    return []
  }
}

/**
 * Parse a single line from `wsl.exe --list --verbose` output.
 * Format: `[*] <name>  <state>  <version>`
 * The asterisk marks the default distro.
 */
function parseVerboseLine(line: string): WslDistro | null {
  // Match: optional leading *, then name, then state, then version number
  const match = line.match(/^\s*(\*)?\s*(\S+)\s+(Running|Stopped|Installing)\s+(\d)\s*$/)
  if (!match) return null

  const version = parseInt(match[4], 10)
  if (version !== 1 && version !== 2) return null

  return {
    name: match[2],
    isDefault: match[1] === '*',
    state: match[3] as WslDistro['state'],
    version: version as 1 | 2,
  }
}

/**
 * Get the name of the default WSL distribution, or null if none.
 */
export function getDefaultDistro(): string | null {
  const distros = listWslDistros()
  const defaultDistro = distros.find(d => d.isDefault)
  return defaultDistro?.name ?? null
}

/**
 * Check whether the `claude` CLI binary is available inside a WSL distro.
 * Uses `execFileSync` (not `execSync`) to prevent shell injection via distro name.
 */
export function checkClaudeInWsl(distro: string): boolean {
  if (process.platform !== 'win32') return false

  try {
    execFileSync('wsl.exe', ['-d', distro, '--', 'which', 'claude'], {
      timeout: WSL_EXEC_TIMEOUT,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Convert a Windows path to a WSL (Linux) path.
 *
 * Handles:
 * - `C:\...` or `C:/...` -> `/mnt/c/...`
 * - `\\wsl$\<distro>\...` -> `/<path>` (Windows 10 UNC format)
 * - `\\wsl.localhost\<distro>\...` -> `/<path>` (Windows 11 UNC format)
 * - Already-linux paths are passed through unchanged
 */
export function convertPathToWsl(windowsPath: string): string {
  // Already a Linux path — pass through
  if (windowsPath.startsWith('/')) return windowsPath

  // UNC path: \\wsl$\<distro>\<path> or \\wsl.localhost\<distro>\<path>
  const wslUncMatch = windowsPath.match(/^\\\\wsl(?:\$|\.localhost)\\([^\\]+)(?:\\(.*))?$/)
  if (wslUncMatch) {
    const rest = wslUncMatch[2]
    if (!rest || rest === '') return '/'
    return '/' + rest.replace(/\\/g, '/')
  }

  // Windows drive path: C:\... or C:/...
  const driveMatch = windowsPath.match(/^([A-Za-z]):[/\\](.*)$/)
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase()
    const rest = driveMatch[2].replace(/\\/g, '/')
    return `/mnt/${drive}/${rest}`
  }

  // Fallback: return as-is (relative paths, etc.)
  return windowsPath
}

/**
 * Convert a Linux path (inside WSL) to a Windows path.
 *
 * Handles:
 * - `/mnt/c/...` -> `C:\...`
 * - Other Linux paths -> `\\wsl.localhost\<distro>\...`
 */
export function convertPathToWindows(linuxPath: string, distro: string): string {
  // Mounted Windows drive: /mnt/<letter>/...
  const mntMatch = linuxPath.match(/^\/mnt\/([a-z])(?:\/(.*))?$/)
  if (mntMatch) {
    const drive = mntMatch[1].toUpperCase()
    const rest = mntMatch[2] ?? ''
    return `${drive}:\\${rest.replace(/\//g, '\\')}`
  }

  // Native Linux path -> UNC
  const winPath = linuxPath.replace(/\//g, '\\')
  return `\\\\wsl.localhost\\${distro}${winPath}`
}

/**
 * Detect whether a path points to a native (Windows) or WSL filesystem.
 *
 * - Absolute Linux paths NOT under /mnt/ -> wsl
 * - `\\wsl$\` or `\\wsl.localhost\` UNC paths -> wsl
 * - Everything else (Windows drive paths, relative, /mnt/) -> native
 */
export function detectRuntimeFromPath(path: string): RuntimeType {
  // UNC WSL paths
  if (path.startsWith('\\\\wsl$\\') || path.startsWith('\\\\wsl.localhost\\')) {
    return 'wsl'
  }

  // Absolute Linux path
  if (path.startsWith('/')) {
    // /mnt/ paths are mounted Windows drives — treat as native
    if (path.startsWith('/mnt/')) return 'native'
    return 'wsl'
  }

  // Everything else: Windows drive paths, relative paths, ~, empty
  return 'native'
}

/**
 * Determine the Windows host IP address that a WSL distro should use
 * to reach the permission hook server running on the Windows host.
 *
 * Logic:
 *  1. If `~/.wslconfig` contains `networkingMode=mirrored` → `127.0.0.1`
 *     (mirrored mode shares the host network stack)
 *  2. If the distro is WSL1 → `127.0.0.1`
 *     (WSL1 shares the host network directly)
 *  3. For WSL2 NAT mode: parse `/etc/resolv.conf` inside the distro —
 *     the nameserver is the Windows host IP on the Hyper-V vSwitch
 *  4. Fallback: `127.0.0.1`
 *
 * SECURITY NOTE: When this returns a non-loopback IP, the permission
 * server must rebind to `0.0.0.0` to be reachable from WSL2. This
 * relaxes the default `127.0.0.1`-only binding documented in CLAUDE.md.
 * The per-launch app secret and per-run tokens still authenticate requests.
 */
export function getWindowsHostIpForWsl(distro: string): string {
  // Step 1: Check for mirrored networking mode in ~/.wslconfig
  try {
    const wslConfigPath = join(homedir(), '.wslconfig')
    const content = readFileSync(wslConfigPath, 'utf-8')
    // Match networkingMode=mirrored (case-insensitive, allow whitespace around =)
    if (/^\s*networkingMode\s*=\s*mirrored\s*$/mi.test(content)) {
      log('WSL networking mode is mirrored — using 127.0.0.1')
      return '127.0.0.1'
    }
  } catch {
    // No .wslconfig or unreadable — continue to next check
  }

  // Step 2: Check if distro is WSL1 (shares host network)
  try {
    const distros = listWslDistros()
    const match = distros.find(d => d.name === distro)
    if (match && match.version === 1) {
      log(`Distro "${distro}" is WSL1 — using 127.0.0.1`)
      return '127.0.0.1'
    }
  } catch {
    // If we can't determine version, fall through to resolv.conf
  }

  // Step 3: WSL2 NAT — extract host IP from /etc/resolv.conf inside the distro
  try {
    const buf = execFileSync('wsl.exe', ['-d', distro, '--', 'cat', '/etc/resolv.conf'], {
      timeout: WSL_EXEC_TIMEOUT,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const text = buf.toString('utf-8')
    // Find the nameserver line (typically there's one, pointing at the Windows host)
    const nsMatch = text.match(/^\s*nameserver\s+([\d.]+)/m)
    if (nsMatch) {
      const ip = nsMatch[1]
      log(`WSL2 NAT host IP for "${distro}": ${ip}`)
      return ip
    }
  } catch (err) {
    log(`Failed to read /etc/resolv.conf in "${distro}": ${err}`)
  }

  // Step 4: Fallback
  log(`Could not determine WSL host IP for "${distro}" — falling back to 127.0.0.1`)
  return '127.0.0.1'
}
