/**
 * WSL process spawner: wraps `wsl.exe` to run Claude CLI
 * inside a specified WSL distribution.
 *
 * Converts Windows paths in cwd and args to WSL-compatible paths.
 * Never uses `shell: true` to avoid injection.
 */

import { spawn, ChildProcess } from 'child_process'
import { convertPathToWsl } from './detection'
import { log as _log } from '../logger'

function log(msg: string): void {
  _log('WslSpawner', msg)
}

export interface WslSpawnOptions {
  distro: string
  args: string[]
  cwd: string
  env: Record<string, string>
  hookSettingsPath?: string
}

/**
 * Windows drive path pattern: starts with a letter followed by :\ or :/
 */
const WINDOWS_DRIVE_RE = /^[A-Za-z]:[/\\]/

/**
 * Spawn a Claude CLI process inside a WSL distribution.
 *
 * - Converts cwd to WSL path
 * - Converts hookSettingsPath in args to WSL path
 * - Converts any arg matching a Windows drive path to WSL path
 * - Spawns wsl.exe with --distribution, --cd, and -- claude <args>
 */
export function spawnInWsl(options: WslSpawnOptions): ChildProcess {
  const { distro, args, cwd, env, hookSettingsPath } = options

  const wslCwd = convertPathToWsl(cwd)

  // Convert Windows paths in args to WSL paths
  const wslArgs = args.map(arg => {
    // If this arg matches the hookSettingsPath, convert it
    if (hookSettingsPath && arg === hookSettingsPath) {
      return convertPathToWsl(arg)
    }
    // Convert any Windows drive path
    if (WINDOWS_DRIVE_RE.test(arg)) {
      return convertPathToWsl(arg)
    }
    return arg
  })

  const fullArgs = [
    '--distribution', distro,
    '--cd', wslCwd,
    '--',
    'claude',
    ...wslArgs,
  ]

  log(`Spawning in WSL [${distro}]: wsl.exe ${fullArgs.join(' ')}`)

  return spawn('wsl.exe', fullArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  })
}
