import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mockPlatform } from '../../helpers/mock-platform'
import * as childProcess from 'child_process'
import type { ChildProcess } from 'child_process'

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  // detection.ts also imports these — provide stubs
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}))

const mockSpawn = vi.mocked(childProcess.spawn)

import { spawnInWsl } from '../../../src/main/wsl/wsl-spawner'

describe('WSL process spawner', () => {
  let restorePlatform: (() => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    restorePlatform = mockPlatform('win32')

    // Return a minimal ChildProcess-like object from spawn
    mockSpawn.mockReturnValue({
      pid: 12345,
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
    } as unknown as ChildProcess)
  })

  afterEach(() => {
    restorePlatform?.()
    restorePlatform = null
  })

  it('spawns wsl.exe with correct distribution, cwd, and args', () => {
    spawnInWsl({
      distro: 'Ubuntu',
      args: ['--verbose', '--output-format', 'stream-json'],
      cwd: 'C:\\Users\\me\\project',
      env: { HOME: '/home/me' },
    })

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = mockSpawn.mock.calls[0]

    expect(cmd).toBe('wsl.exe')
    expect(args).toContain('--distribution')
    expect(args).toContain('Ubuntu')
    expect(args).toContain('--cd')
    expect(args).toContain('/mnt/c/Users/me/project')
    expect(args).toContain('--')
    expect(args).toContain('claude')
    // The original args should follow 'claude'
    const claudeIdx = args!.indexOf('claude')
    expect(args!.slice(claudeIdx + 1)).toEqual(['--verbose', '--output-format', 'stream-json'])

    // No shell: true
    expect(opts).toBeDefined()
    expect((opts as childProcess.SpawnOptions).shell).toBeFalsy()
  })

  it('converts hookSettingsPath in args to WSL path', () => {
    spawnInWsl({
      distro: 'Ubuntu',
      args: ['--settings', 'C:\\Users\\me\\.clui\\settings.json', '--verbose'],
      cwd: '/home/me/project',
      env: {},
      hookSettingsPath: 'C:\\Users\\me\\.clui\\settings.json',
    })

    const [, args] = mockSpawn.mock.calls[0]
    // The hookSettingsPath should be converted
    expect(args).toContain('/mnt/c/Users/me/.clui/settings.json')
    // Original Windows path should NOT remain
    expect(args).not.toContain('C:\\Users\\me\\.clui\\settings.json')
  })

  it('converts Windows drive paths in args to WSL paths', () => {
    spawnInWsl({
      distro: 'Ubuntu',
      args: ['--add-dir', 'D:\\extra\\dir', '--verbose'],
      cwd: 'C:\\Users\\me',
      env: {},
    })

    const [, args] = mockSpawn.mock.calls[0]
    expect(args).toContain('/mnt/d/extra/dir')
    expect(args).not.toContain('D:\\extra\\dir')
  })

  it('passes through already-linux paths in args', () => {
    spawnInWsl({
      distro: 'Ubuntu',
      args: ['--add-dir', '/home/me/extra'],
      cwd: '/home/me/project',
      env: {},
    })

    const [, args] = mockSpawn.mock.calls[0]
    expect(args).toContain('/home/me/extra')
  })

  it('does not set shell: true in spawn options', () => {
    spawnInWsl({
      distro: 'Ubuntu',
      args: [],
      cwd: 'C:\\Users\\me',
      env: {},
    })

    const [, , opts] = mockSpawn.mock.calls[0]
    expect((opts as childProcess.SpawnOptions).shell).toBeFalsy()
  })

  it('passes env and stdio configuration', () => {
    spawnInWsl({
      distro: 'Ubuntu',
      args: [],
      cwd: 'C:\\Users\\me',
      env: { FOO: 'bar' },
    })

    const [, , opts] = mockSpawn.mock.calls[0]
    const spawnOpts = opts as childProcess.SpawnOptions
    expect(spawnOpts.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    expect(spawnOpts.env).toEqual(expect.objectContaining({ FOO: 'bar' }))
  })

  it('converts cwd that is already a Linux path', () => {
    spawnInWsl({
      distro: 'Ubuntu',
      args: [],
      cwd: '/home/me/project',
      env: {},
    })

    const [, args] = mockSpawn.mock.calls[0]
    const cdIdx = args!.indexOf('--cd')
    expect(args![cdIdx + 1]).toBe('/home/me/project')
  })
})
