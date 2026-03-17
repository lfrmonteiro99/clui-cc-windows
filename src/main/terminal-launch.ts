/**
 * Terminal launch command builder — platform-aware, supports multiple
 * Windows terminal providers (cmd, PowerShell, Windows Terminal).
 */

export type WindowsTerminal = 'cmd' | 'powershell' | 'wt'

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
  const posixCmd = `cd "${projectPath.replace(/"/g, '\\"')}" && ${baseCmd}`
  return {
    program: 'x-terminal-emulator',
    args: ['-e', `bash -lc '${posixCmd.replace(/'/g, `'\\''`)}'`],
  }
}
