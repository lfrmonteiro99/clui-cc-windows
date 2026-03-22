/**
 * TDD RED tests for new IPC channels: opacity, toggle shortcut, log path, draggable.
 */
import { describe, it, expect } from 'vitest'
import { IPC } from '../../src/shared/types'

describe('IPC channel constants for window features', () => {
  it('defines SET_OPACITY channel', () => {
    expect(IPC.SET_OPACITY).toBe('clui:set-opacity')
  })

  it('defines SET_DRAGGABLE channel', () => {
    expect(IPC.SET_DRAGGABLE).toBe('clui:set-draggable')
  })

  it('defines SET_TOGGLE_SHORTCUT channel', () => {
    expect(IPC.SET_TOGGLE_SHORTCUT).toBe('clui:set-toggle-shortcut')
  })

  it('defines GET_LOG_PATH channel', () => {
    expect(IPC.GET_LOG_PATH).toBe('clui:get-log-path')
  })

  it('defines SET_LOG_LEVEL channel', () => {
    expect(IPC.SET_LOG_LEVEL).toBe('clui:set-log-level')
  })

  it('defines SET_WIDTH_MODE channel', () => {
    expect(IPC.SET_WIDTH_MODE).toBe('clui:set-width-mode')
  })
})
