import { describe, it, expect } from 'vitest'
import { SLASH_COMMANDS, getFilteredCommands } from '../../../renderer/components/SlashCommandMenu'
import { getDefaultShortcutBindings } from '../../../shared/keyboard-shortcuts'
import { IPC } from '../../../shared/types'

describe('Session Forking — Types & Wiring', () => {
  it('IPC.FORK_SESSION is defined', () => {
    expect(IPC.FORK_SESSION).toBe('clui:fork-session')
  })

  it('RunOptions supports forkSession and forkFromSessionId fields', () => {
    // Type-level check: this compiles only if the fields exist
    const opts: import('../../../shared/types').RunOptions = {
      prompt: 'test',
      projectPath: '/tmp',
      forkSession: true,
      forkFromSessionId: 'abc-123',
    }
    expect(opts.forkSession).toBe(true)
    expect(opts.forkFromSessionId).toBe('abc-123')
  })

  it('TabState supports parentSessionId field', () => {
    // Type-level check
    const partial: Partial<import('../../../shared/types').TabState> = {
      parentSessionId: 'parent-session-xyz',
    }
    expect(partial.parentSessionId).toBe('parent-session-xyz')
  })
})

describe('Session Forking — Slash Command', () => {
  it('/fork command is in SLASH_COMMANDS', () => {
    const forkCmd = SLASH_COMMANDS.find((c) => c.command === '/fork')
    expect(forkCmd).toBeDefined()
    expect(forkCmd!.description).toContain('Fork')
  })

  it('/fork appears in filtered results when typing /f', () => {
    const results = getFilteredCommands('/f')
    const forkCmd = results.find((c) => c.command === '/fork')
    expect(forkCmd).toBeDefined()
  })

  it('/fork appears in filtered results when typing /fork', () => {
    const results = getFilteredCommands('/fork')
    expect(results).toHaveLength(1)
    expect(results[0].command).toBe('/fork')
  })
})

describe('Session Forking — Keyboard Shortcut', () => {
  it('fork-session shortcut is defined for Windows', () => {
    const bindings = getDefaultShortcutBindings(false)
    const forkBinding = bindings.find((b) => b.id === 'fork-session')
    expect(forkBinding).toBeDefined()
    expect(forkBinding!.defaultKeys).toBe('Ctrl+Shift+F')
  })

  it('fork-session shortcut is defined for macOS', () => {
    const bindings = getDefaultShortcutBindings(true)
    const forkBinding = bindings.find((b) => b.id === 'fork-session')
    expect(forkBinding).toBeDefined()
    expect(forkBinding!.defaultKeys).toBe('Cmd+Shift+F')
  })
})
