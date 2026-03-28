/**
 * Terminal launch command builder — platform-aware, supports multiple
 * Windows terminal providers (cmd, PowerShell, Windows Terminal).
 * Linux: auto-detects installed terminal emulators with per-terminal arg syntax.
 */

import { execSync } from 'child_process'

export type WindowsTerminal = 'cmd' | 'powershell' | 'wt'

/**
 * Exec flag used to pass a command to the terminal:
 * - '-e'  — most terminals (konsole, alacritty, xterm, wezterm, x-terminal-emulator)
 * - '--'  — gnome-terminal
 * - null  — kitty (command appended directly)
 */
export interface LinuxTerminalInfo {
  program: string
  execFlag: '-e' | '--' | null
}

export interface TerminalCommandOptions {
  projectPath: string
  claudeBin: string
  sessionId?: string | null
  terminal?: WindowsTerminal
}

export interface TerminalCommand {
  program: string
  args: string[]
}

/** Ordered candidate list: [binary, execFlag] */
const LINUX_TERMINAL_CANDIDATES: readonly [string, LinuxTerminalInfo['execFlag']][] = [
  ['x-terminal-emulator', '-e'],
  ['konsole', '-e'],
  ['gnome-terminal', '--'],
  ['xfce4-terminal', '-e'],
  ['alacritty', '-e'],
  ['kitty', null],
  ['wezterm', '-e'],
  ['xterm', '-e'],
] as const

let cachedTerminal: LinuxTerminalInfo | null = null

/**
 * Detect the first available Linux terminal emulator.
 * Checks $TERMINAL env var first, then walks a ranked candidate list.
 * Result is cached for the lifetime of the process.
 */
export function findLinuxTerminal(): LinuxTerminalInfo {
  if (cachedTerminal) return cachedTerminal

  // 1. Respect $TERMINAL env var
  const envTerminal = process.env.TERMINAL
  if (envTerminal) {
    if (isTerminalAvailable(envTerminal)) {
      const flag = getExecFlag(envTerminal)
      cachedTerminal = { program: envTerminal, execFlag: flag }
      return cachedTerminal
    }
    console.warn(`[terminal-launch] $TERMINAL="${envTerminal}" not found, falling back to detection`)
  }

  // 2. Walk candidate list
  for (const [binary, flag] of LINUX_TERMINAL_CANDIDATES) {
    if (isTerminalAvailable(binary)) {
      cachedTerminal = { program: binary, execFlag: flag }
      return cachedTerminal
    }
  }

  throw new Error(
    'No terminal emulator found. Install one of: ' +
      LINUX_TERMINAL_CANDIDATES.map(([b]) => b).join(', ') +
      ' — or set $TERMINAL to your preferred terminal.',
  )
}

/** Clear the cached terminal (for testing). */
export function clearTerminalCache(): void {
  cachedTerminal = null
}

/** Check whether a binary exists on PATH using `which`. */
function isTerminalAvailable(binary: string): boolean {
  try {
    execSync(`which ${binary}`, { stdio: 'pipe', timeout: 3000 })
    return true
  } catch (err) {
    console.debug(`[terminal-launch] "${binary}" not found:`, err)
    return false
  }
}

/** Map known terminal names to their exec flag. Falls back to '-e'. */
function getExecFlag(binary: string): LinuxTerminalInfo['execFlag'] {
  const known = LINUX_TERMINAL_CANDIDATES.find(([b]) => b === binary)
  if (known) return known[1]

  // For unknown terminals from $TERMINAL, check common patterns
  if (binary.includes('gnome-terminal')) return '--'
  if (binary.includes('kitty')) return null
  return '-e' // safe default — most terminals support -e
}

/**
 * Build a TerminalCommand for a given LinuxTerminalInfo.
 * Exported for testability.
 */
export function buildLinuxTerminalCommand(
  info: LinuxTerminalInfo,
  projectPath: string,
  baseCmd: string,
): TerminalCommand {
  const escapedPath = projectPath.replace(/"/g, '\\"')
  const posixCmd = `cd "${escapedPath}" && ${baseCmd}`
  const shellCmd = `bash -lc '${posixCmd.replace(/'/g, `'\\''`)}'`

  if (info.execFlag === null) {
    // kitty: command args appended directly
    return {
      program: info.program,
      args: ['bash', '-lc', `${posixCmd.replace(/'/g, `'\\''`)}`],
    }
  }

  return {
    program: info.program,
    args: [info.execFlag, shellCmd],
  }
}

export function buildTerminalCommand(options: TerminalCommandOptions): TerminalCommand {
  const { projectPath, claudeBin, sessionId, terminal } = options
  const baseCmd = sessionId ? `${claudeBin} --resume ${sessionId}` : claudeBin

  if (process.platform === 'win32') {
    return buildWindowsCommand(projectPath, baseCmd, terminal || 'cmd')
  }

  if (process.platform === 'darwin') {
    return buildDarwinCommand(projectPath, baseCmd)
  }

  return buildLinuxCommand(projectPath, baseCmd)
}

function buildWindowsCommand(projectPath: string, baseCmd: string, terminal: WindowsTerminal): TerminalCommand {
  const cdCmd = `cd /d "${projectPath}" && ${baseCmd}`

  switch (terminal) {
    case 'powershell':
      return {
        program: 'powershell.exe',
        args: ['-NoExit', '-Command', `Set-Location "${projectPath}"; ${baseCmd}`],
      }

    case 'wt':
      return {
        program: 'wt.exe',
        args: ['new-tab', '--startingDirectory', projectPath, 'cmd.exe', '/k', baseCmd],
      }

    case 'cmd':
    default:
      return {
        program: 'cmd.exe',
        args: ['/c', 'start', 'cmd.exe', '/k', cdCmd],
      }
  }
}

function buildDarwinCommand(projectPath: string, baseCmd: string): TerminalCommand {
  const posixCmd = `cd "${projectPath.replace(/"/g, '\\"')}" && ${baseCmd}`
  const escaped = posixCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const script = `tell application "Terminal"\n  activate\n  do script "${escaped}"\nend tell`

  return {
    program: '/usr/bin/osascript',
    args: ['-e', script],
  }
}

function buildLinuxCommand(projectPath: string, baseCmd: string): TerminalCommand {
  const info = findLinuxTerminal()
  return buildLinuxTerminalCommand(info, projectPath, baseCmd)
}
