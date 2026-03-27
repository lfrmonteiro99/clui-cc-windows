/**
 * TERM-013: TerminalStore regression tests (Priority 2)
 *
 * Tests the Zustand terminal store for correct state management,
 * tab lifecycle, font sizing, and IPC integration.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock window.clui
const mockClui = {
  terminalCreate: vi.fn().mockResolvedValue({ termTabId: 'mock-term-1' }),
  terminalClose: vi.fn().mockResolvedValue(undefined),
  terminalAvailable: vi.fn().mockResolvedValue(true),
}
Object.defineProperty(globalThis, 'window', {
  value: { ...globalThis.window, clui: mockClui, dispatchEvent: vi.fn() },
  writable: true,
})

// Mock navigator.platform
Object.defineProperty(globalThis, 'navigator', {
  value: { ...globalThis.navigator, platform: 'Win32' },
  writable: true,
})

import { useTerminalStore } from '../../src/renderer/stores/terminalStore'

describe('TerminalStore', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      termTabs: [],
      activeTermTabId: null,
      terminalMode: false,
      ptyAvailable: true,
      fontSize: 13,
    })
    vi.clearAllMocks()
  })

  it('starts with terminal mode off', () => {
    expect(useTerminalStore.getState().terminalMode).toBe(false)
  })

  it('starts with no terminal tabs', () => {
    expect(useTerminalStore.getState().termTabs).toHaveLength(0)
  })

  it('toggleMode flips terminalMode', () => {
    useTerminalStore.getState().toggleMode()
    expect(useTerminalStore.getState().terminalMode).toBe(true)
    useTerminalStore.getState().toggleMode()
    expect(useTerminalStore.getState().terminalMode).toBe(false)
  })

  it('toggleMode does nothing when ptyAvailable is false', () => {
    useTerminalStore.setState({ ptyAvailable: false })
    useTerminalStore.getState().toggleMode()
    expect(useTerminalStore.getState().terminalMode).toBe(false)
  })

  it('createTermTab adds a tab and sets it active', async () => {
    const id = await useTerminalStore.getState().createTermTab()
    expect(id).toBe('mock-term-1')
    const state = useTerminalStore.getState()
    expect(state.termTabs).toHaveLength(1)
    expect(state.termTabs[0].id).toBe('mock-term-1')
    expect(state.termTabs[0].status).toBe('active')
    expect(state.activeTermTabId).toBe('mock-term-1')
  })

  it('closeTermTab removes tab and calls IPC', async () => {
    await useTerminalStore.getState().createTermTab()
    useTerminalStore.getState().closeTermTab('mock-term-1')
    expect(useTerminalStore.getState().termTabs).toHaveLength(0)
    expect(mockClui.terminalClose).toHaveBeenCalledWith('mock-term-1')
  })

  it('setActiveTermTab changes active tab', async () => {
    mockClui.terminalCreate
      .mockResolvedValueOnce({ termTabId: 'term-a' })
      .mockResolvedValueOnce({ termTabId: 'term-b' })
    await useTerminalStore.getState().createTermTab()
    await useTerminalStore.getState().createTermTab()
    useTerminalStore.getState().setActiveTermTab('term-a')
    expect(useTerminalStore.getState().activeTermTabId).toBe('term-a')
  })

  it('handleTerminalExit sets tab status to exited', async () => {
    await useTerminalStore.getState().createTermTab()
    useTerminalStore.getState().handleTerminalExit('mock-term-1', 0)
    const tab = useTerminalStore.getState().termTabs.find((t) => t.id === 'mock-term-1')
    expect(tab?.status).toBe('exited')
    expect(tab?.exitCode).toBe(0)
  })

  it('setFontSize clamps between 9 and 24', () => {
    useTerminalStore.getState().setFontSize(5)
    expect(useTerminalStore.getState().fontSize).toBe(9)
    useTerminalStore.getState().setFontSize(30)
    expect(useTerminalStore.getState().fontSize).toBe(24)
    useTerminalStore.getState().setFontSize(16)
    expect(useTerminalStore.getState().fontSize).toBe(16)
  })

  it('checkAvailability sets ptyAvailable', async () => {
    useTerminalStore.setState({ ptyAvailable: null })
    await useTerminalStore.getState().checkAvailability()
    expect(useTerminalStore.getState().ptyAvailable).toBe(true)
  })

  // ─── Priority 2: Regression tests (TERM-013) ───

  describe('createTermTab with null termTabId', () => {
    it('throws when IPC returns null termTabId (not silent failure)', async () => {
      mockClui.terminalCreate.mockResolvedValueOnce({ termTabId: null, error: 'spawn failed' })
      await expect(useTerminalStore.getState().createTermTab()).rejects.toThrow('spawn failed')
    })

    it('throws with default message when IPC returns null termTabId and no error', async () => {
      mockClui.terminalCreate.mockResolvedValueOnce({ termTabId: null })
      await expect(useTerminalStore.getState().createTermTab()).rejects.toThrow('Failed to create terminal')
    })
  })

  describe('closeTermTab middle tab activates last remaining tab', () => {
    it('activates the last remaining tab when closing the active middle tab', async () => {
      mockClui.terminalCreate
        .mockResolvedValueOnce({ termTabId: 'term-1' })
        .mockResolvedValueOnce({ termTabId: 'term-2' })
        .mockResolvedValueOnce({ termTabId: 'term-3' })

      await useTerminalStore.getState().createTermTab()
      await useTerminalStore.getState().createTermTab()
      await useTerminalStore.getState().createTermTab()

      // Active is term-3 (last created). Close term-2 (middle).
      useTerminalStore.getState().setActiveTermTab('term-2')
      useTerminalStore.getState().closeTermTab('term-2')

      const state = useTerminalStore.getState()
      expect(state.termTabs).toHaveLength(2)
      // When closing the active tab, the last remaining tab becomes active
      expect(state.activeTermTabId).toBe('term-3')
    })
  })

  describe('closeTermTab last tab sets activeTermTabId to null', () => {
    it('sets activeTermTabId to null when last tab is closed', async () => {
      await useTerminalStore.getState().createTermTab()
      useTerminalStore.getState().closeTermTab('mock-term-1')

      const state = useTerminalStore.getState()
      expect(state.termTabs).toHaveLength(0)
      expect(state.activeTermTabId).toBeNull()
    })
  })

  describe('handleTerminalExit for unknown ID', () => {
    it('does not mutate state for unknown tab ID', async () => {
      await useTerminalStore.getState().createTermTab()
      const stateBefore = useTerminalStore.getState().termTabs.map((t) => ({ ...t }))

      useTerminalStore.getState().handleTerminalExit('nonexistent-id', 1)

      const stateAfter = useTerminalStore.getState().termTabs
      // Tab data should be unchanged — no mutation to existing tabs
      expect(stateAfter).toHaveLength(stateBefore.length)
      expect(stateAfter[0].status).toBe(stateBefore[0].status)
      expect(stateAfter[0].exitCode).toBe(stateBefore[0].exitCode)
    })
  })

  describe('setFontSize dispatches custom event', () => {
    it('dispatches clui-terminal-shortcut event with correct font size value', () => {
      const dispatchSpy = vi.fn()
      ;(window as any).dispatchEvent = dispatchSpy

      useTerminalStore.getState().setFontSize(18)

      expect(dispatchSpy).toHaveBeenCalledTimes(1)
      const event = dispatchSpy.mock.calls[0][0]
      expect(event).toBeInstanceOf(CustomEvent)
      expect(event.type).toBe('clui-terminal-shortcut')
      expect(event.detail).toEqual({ action: 'font-size-changed', fontSize: 18 })
    })

    it('dispatches clamped value when size is out of range', () => {
      const dispatchSpy = vi.fn()
      ;(window as any).dispatchEvent = dispatchSpy

      useTerminalStore.getState().setFontSize(100)

      const event = dispatchSpy.mock.calls[0][0]
      expect(event.detail.fontSize).toBe(24) // clamped to max
    })
  })

  describe('checkAvailability on IPC rejection', () => {
    it('sets ptyAvailable to false when IPC rejects', async () => {
      mockClui.terminalAvailable.mockRejectedValueOnce(new Error('IPC failed'))
      useTerminalStore.setState({ ptyAvailable: null })

      await useTerminalStore.getState().checkAvailability()

      expect(useTerminalStore.getState().ptyAvailable).toBe(false)
    })
  })
})
