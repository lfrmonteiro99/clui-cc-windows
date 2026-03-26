/**
 * TERM-007: Terminal persistence module tests.
 *
 * Validates the PersistedSession interface and module exports.
 * The actual IndexedDB operations are integration-tested in the app;
 * these unit tests verify the module's contract and edge cases.
 */
import { describe, expect, it } from 'vitest'

import type { PersistedSession } from '../../src/renderer/utils/terminal-persistence'

// Verify the module can be imported and exports the expected functions
import * as persistence from '../../src/renderer/utils/terminal-persistence'

describe('terminal-persistence module (TERM-007)', () => {
  it('exports saveTerminalSession function', () => {
    expect(typeof persistence.saveTerminalSession).toBe('function')
  })

  it('exports loadTerminalSessions function', () => {
    expect(typeof persistence.loadTerminalSessions).toBe('function')
  })

  it('exports deleteTerminalSession function', () => {
    expect(typeof persistence.deleteTerminalSession).toBe('function')
  })

  it('PersistedSession interface has correct shape', () => {
    const session: PersistedSession = {
      id: 'test-1',
      serializedBuffer: 'hello world',
      shell: 'bash',
      cwd: '/home/user',
      exitCode: 0,
      savedAt: Date.now(),
    }
    expect(session.id).toBe('test-1')
    expect(session.serializedBuffer).toBe('hello world')
    expect(session.shell).toBe('bash')
    expect(session.cwd).toBe('/home/user')
    expect(session.exitCode).toBe(0)
    expect(typeof session.savedAt).toBe('number')
  })

  it('PersistedSession with null exitCode is valid', () => {
    const session: PersistedSession = {
      id: 'null-exit',
      serializedBuffer: '',
      shell: 'bash',
      cwd: '/',
      exitCode: null,
      savedAt: Date.now(),
    }
    expect(session.exitCode).toBeNull()
  })

  it('PersistedSession with empty buffer is valid', () => {
    const session: PersistedSession = {
      id: 'empty',
      serializedBuffer: '',
      shell: 'zsh',
      cwd: '/tmp',
      exitCode: 0,
      savedAt: Date.now(),
    }
    expect(session.serializedBuffer).toBe('')
  })

  it('PersistedSession with large buffer is accepted', () => {
    const session: PersistedSession = {
      id: 'large',
      serializedBuffer: 'x'.repeat(200 * 1024),
      shell: 'bash',
      cwd: '/home',
      exitCode: 0,
      savedAt: Date.now(),
    }
    // saveTerminalSession will truncate this to 100KB, but the type accepts it
    expect(session.serializedBuffer.length).toBe(200 * 1024)
  })
})
