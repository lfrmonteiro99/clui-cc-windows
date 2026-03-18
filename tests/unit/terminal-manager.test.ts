import { describe, expect, it } from 'vitest'
import { IPC } from '../../src/shared/types'

describe('Terminal IPC channels', () => {
  it('TERMINAL_CREATE is defined', () => {
    expect(IPC.TERMINAL_CREATE).toBe('clui:terminal-create')
  })

  it('TERMINAL_WRITE is defined', () => {
    expect(IPC.TERMINAL_WRITE).toBe('clui:terminal-write')
  })

  it('TERMINAL_RESIZE is defined', () => {
    expect(IPC.TERMINAL_RESIZE).toBe('clui:terminal-resize')
  })

  it('TERMINAL_CLOSE is defined', () => {
    expect(IPC.TERMINAL_CLOSE).toBe('clui:terminal-close')
  })

  it('TERMINAL_DATA is defined', () => {
    expect(IPC.TERMINAL_DATA).toBe('clui:terminal-data')
  })

  it('TERMINAL_EXIT is defined', () => {
    expect(IPC.TERMINAL_EXIT).toBe('clui:terminal-exit')
  })

  it('all terminal channels follow clui: prefix convention', () => {
    const termChannels = Object.entries(IPC).filter(([k]) => k.startsWith('TERMINAL_'))
    expect(termChannels.length).toBeGreaterThanOrEqual(6)
    for (const [, v] of termChannels) {
      expect(v).toMatch(/^clui:terminal-/)
    }
  })
})

describe('Terminal types', () => {
  it('TerminalTab interface shape', () => {
    // Type-level test — if this compiles, the interface exists
    const tab: import('../../src/shared/types').TerminalTab = {
      id: 'test',
      title: 'bash',
      shell: '/bin/bash',
      cwd: '/home/user',
      status: 'active',
      exitCode: null,
    }
    expect(tab.id).toBe('test')
    expect(tab.status).toBe('active')
  })

  it('TerminalCreateOptions interface shape', () => {
    const opts: import('../../src/shared/types').TerminalCreateOptions = {
      shell: 'powershell.exe',
      cwd: 'C:\\Users\\test',
    }
    expect(opts.shell).toBe('powershell.exe')
  })

  it('TerminalCreateOptions fields are optional', () => {
    const opts: import('../../src/shared/types').TerminalCreateOptions = {}
    expect(opts.shell).toBeUndefined()
  })
})
