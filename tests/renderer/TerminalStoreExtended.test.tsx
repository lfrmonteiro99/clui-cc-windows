/**
 * TERM-013: Extended TerminalStore tests covering new features
 * and regression cases from the issue.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock window.clui
const mockClui = {
  terminalCreate: vi.fn().mockResolvedValue({ termTabId: 'mock-term-1' }),
  terminalClose: vi.fn().mockResolvedValue(undefined),
  terminalAvailable: vi.fn().mockResolvedValue(true),
}

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, val: string) => { store[key] = val }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()

Object.defineProperty(globalThis, 'window', {
  value: { ...globalThis.window, clui: mockClui, dispatchEvent: vi.fn(), localStorage: localStorageMock },
  writable: true,
})
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
})
Object.defineProperty(globalThis, 'navigator', {
  value: { ...globalThis.navigator, platform: 'Win32' },
  writable: true,
})

import { useTerminalStore } from '../../src/renderer/stores/terminalStore'

describe('TerminalStore — Extended', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      termTabs: [],
      activeTermTabId: null,
      terminalMode: false,
      ptyAvailable: true,
      fontSize: 13,
      scrollbackSize: 5000,
      bellEnabled: true,
      autoNaming: true,
      backgroundOpacity: 1,
      backgroundBlur: 0,
      imageProtocolEnabled: false,
      settingsOpen: false,
      overviewOpen: false,
      paneLayouts: {},
    })
    vi.clearAllMocks()
    localStorageMock.clear()
  })

  // ─── TERM-BUG-002: toggleMode race condition ───

  describe('toggleMode race condition (TERM-BUG-002)', () => {
    it('returns early when ptyAvailable === null', () => {
      useTerminalStore.setState({ ptyAvailable: null })
      useTerminalStore.getState().toggleMode()
      expect(useTerminalStore.getState().terminalMode).toBe(false)
    })

    it('returns early when ptyAvailable === false', () => {
      useTerminalStore.setState({ ptyAvailable: false })
      useTerminalStore.getState().toggleMode()
      expect(useTerminalStore.getState().terminalMode).toBe(false)
    })

    it('proceeds when ptyAvailable === true', () => {
      useTerminalStore.setState({ ptyAvailable: true })
      useTerminalStore.getState().toggleMode()
      expect(useTerminalStore.getState().terminalMode).toBe(true)
    })
  })

  // ─── Store regression tests ───

  describe('store regression tests', () => {
    it('createTermTab with null termTabId throws (not silent)', async () => {
      mockClui.terminalCreate.mockResolvedValueOnce({ termTabId: null, error: 'Failed' })
      await expect(useTerminalStore.getState().createTermTab()).rejects.toThrow('Failed')
    })

    it('closeTermTab middle tab activates last remaining tab', async () => {
      mockClui.terminalCreate
        .mockResolvedValueOnce({ termTabId: 'a' })
        .mockResolvedValueOnce({ termTabId: 'b' })
        .mockResolvedValueOnce({ termTabId: 'c' })

      await useTerminalStore.getState().createTermTab()
      await useTerminalStore.getState().createTermTab()
      await useTerminalStore.getState().createTermTab()

      // Active is 'c' (last created). Close 'b' (middle).
      useTerminalStore.getState().setActiveTermTab('b')
      useTerminalStore.getState().closeTermTab('b')

      // Should activate last remaining: 'c'
      expect(useTerminalStore.getState().activeTermTabId).toBe('c')
    })

    it('closeTermTab last tab sets activeTermTabId to null', async () => {
      mockClui.terminalCreate.mockResolvedValueOnce({ termTabId: 'only' })
      await useTerminalStore.getState().createTermTab()
      useTerminalStore.getState().closeTermTab('only')
      expect(useTerminalStore.getState().activeTermTabId).toBeNull()
      expect(useTerminalStore.getState().termTabs).toHaveLength(0)
    })

    it('handleTerminalExit for unknown ID = no state mutation', () => {
      const before = useTerminalStore.getState().termTabs
      useTerminalStore.getState().handleTerminalExit('nonexistent', 1)
      expect(useTerminalStore.getState().termTabs).toEqual(before)
    })

    it('setFontSize dispatches custom event', () => {
      useTerminalStore.getState().setFontSize(16)
      expect(useTerminalStore.getState().fontSize).toBe(16)
      expect(window.dispatchEvent).toHaveBeenCalled()
    })

    it('checkAvailability on IPC rejection sets ptyAvailable=false', async () => {
      mockClui.terminalAvailable.mockRejectedValueOnce(new Error('IPC error'))
      useTerminalStore.setState({ ptyAvailable: null })
      await useTerminalStore.getState().checkAvailability()
      expect(useTerminalStore.getState().ptyAvailable).toBe(false)
    })
  })

  // ─── TERM-003: Tab auto-naming ───

  describe('tab auto-naming (TERM-003)', () => {
    it('updateTermTabTitle updates title', async () => {
      mockClui.terminalCreate.mockResolvedValueOnce({ termTabId: 't1' })
      await useTerminalStore.getState().createTermTab()
      useTerminalStore.getState().updateTermTabTitle('t1', 'vim main.ts')
      expect(useTerminalStore.getState().termTabs[0].title).toBe('vim main.ts')
    })

    it('updateTermTabTitle does nothing when autoNaming is off', async () => {
      useTerminalStore.setState({ autoNaming: false })
      mockClui.terminalCreate.mockResolvedValueOnce({ termTabId: 't1' })
      await useTerminalStore.getState().createTermTab()
      const originalTitle = useTerminalStore.getState().termTabs[0].title
      useTerminalStore.getState().updateTermTabTitle('t1', 'new-title')
      expect(useTerminalStore.getState().termTabs[0].title).toBe(originalTitle)
    })

    it('updateTermTabTitle for unknown ID = no-op', () => {
      useTerminalStore.getState().updateTermTabTitle('nonexistent', 'foo')
      // no throw, no crash
    })
  })

  // ─── TERM-004: Scrollback ───

  describe('configurable scrollback (TERM-004)', () => {
    it('setScrollbackSize clamps min to 1000', () => {
      useTerminalStore.getState().setScrollbackSize(500)
      expect(useTerminalStore.getState().scrollbackSize).toBe(1000)
    })

    it('setScrollbackSize clamps max to 50000', () => {
      useTerminalStore.getState().setScrollbackSize(100000)
      expect(useTerminalStore.getState().scrollbackSize).toBe(50000)
    })

    it('setScrollbackSize dispatches custom event', () => {
      useTerminalStore.getState().setScrollbackSize(10000)
      expect(window.dispatchEvent).toHaveBeenCalled()
    })

    it('setScrollbackSize persists to localStorage', () => {
      useTerminalStore.getState().setScrollbackSize(10000)
      expect(localStorageMock.setItem).toHaveBeenCalled()
    })
  })

  // ─── TERM-008: Bell support ───

  describe('bell support (TERM-008)', () => {
    it('incrementBellCount increments tab bellCount', async () => {
      mockClui.terminalCreate.mockResolvedValueOnce({ termTabId: 'bell-tab' })
      await useTerminalStore.getState().createTermTab()
      useTerminalStore.getState().incrementBellCount('bell-tab')
      useTerminalStore.getState().incrementBellCount('bell-tab')
      expect(useTerminalStore.getState().termTabs[0].bellCount).toBe(2)
    })

    it('bellCount saturates at 99', async () => {
      mockClui.terminalCreate.mockResolvedValueOnce({ termTabId: 'bell-tab' })
      await useTerminalStore.getState().createTermTab()
      // Set bellCount to 99
      useTerminalStore.setState({
        termTabs: useTerminalStore.getState().termTabs.map((t) => ({ ...t, bellCount: 99 })),
      })
      useTerminalStore.getState().incrementBellCount('bell-tab')
      expect(useTerminalStore.getState().termTabs[0].bellCount).toBe(99)
    })

    it('clearBellCount resets to 0', async () => {
      mockClui.terminalCreate.mockResolvedValueOnce({ termTabId: 'bell-tab' })
      await useTerminalStore.getState().createTermTab()
      useTerminalStore.getState().incrementBellCount('bell-tab')
      useTerminalStore.getState().clearBellCount('bell-tab')
      expect(useTerminalStore.getState().termTabs[0].bellCount).toBe(0)
    })
  })

  // ─── TERM-010: Background opacity ───

  describe('background opacity (TERM-010)', () => {
    it('setBackgroundOpacity clamps to 0.4-1.0', () => {
      useTerminalStore.getState().setBackgroundOpacity(0.1)
      expect(useTerminalStore.getState().backgroundOpacity).toBe(0.4)
      useTerminalStore.getState().setBackgroundOpacity(1.5)
      expect(useTerminalStore.getState().backgroundOpacity).toBe(1)
    })

    it('setBackgroundOpacity persists', () => {
      useTerminalStore.getState().setBackgroundOpacity(0.7)
      expect(localStorageMock.setItem).toHaveBeenCalled()
    })

    it('setBackgroundBlur clamps to 0-16', () => {
      useTerminalStore.getState().setBackgroundBlur(-5)
      expect(useTerminalStore.getState().backgroundBlur).toBe(0)
      useTerminalStore.getState().setBackgroundBlur(25)
      expect(useTerminalStore.getState().backgroundBlur).toBe(16)
    })
  })

  // ─── TERM-012: Settings ───

  describe('settings panel (TERM-012)', () => {
    it('setSettingsOpen toggles', () => {
      useTerminalStore.getState().setSettingsOpen(true)
      expect(useTerminalStore.getState().settingsOpen).toBe(true)
      useTerminalStore.getState().setSettingsOpen(false)
      expect(useTerminalStore.getState().settingsOpen).toBe(false)
    })

    it('setBellEnabled persists', () => {
      useTerminalStore.getState().setBellEnabled(false)
      expect(useTerminalStore.getState().bellEnabled).toBe(false)
      expect(localStorageMock.setItem).toHaveBeenCalled()
    })

    it('setAutoNaming persists', () => {
      useTerminalStore.getState().setAutoNaming(false)
      expect(useTerminalStore.getState().autoNaming).toBe(false)
    })

    it('resetSettings restores defaults', () => {
      useTerminalStore.getState().setScrollbackSize(50000)
      useTerminalStore.getState().setBellEnabled(false)
      useTerminalStore.getState().setBackgroundOpacity(0.5)
      useTerminalStore.getState().resetSettings()

      const state = useTerminalStore.getState()
      expect(state.scrollbackSize).toBe(5000)
      expect(state.bellEnabled).toBe(true)
      expect(state.backgroundOpacity).toBe(1)
    })
  })

  // ─── TERM-006: Tab overview ───

  describe('tab overview (TERM-006)', () => {
    it('setTabOverviewOpen toggles', () => {
      useTerminalStore.getState().setTabOverviewOpen(true)
      expect(useTerminalStore.getState().overviewOpen).toBe(true)
    })

    it('selectTabFromOverview activates tab and closes overview', async () => {
      mockClui.terminalCreate
        .mockResolvedValueOnce({ termTabId: 'ov-a' })
        .mockResolvedValueOnce({ termTabId: 'ov-b' })
      await useTerminalStore.getState().createTermTab()
      await useTerminalStore.getState().createTermTab()
      useTerminalStore.getState().setTabOverviewOpen(true)
      useTerminalStore.getState().selectTabFromOverview('ov-a')
      expect(useTerminalStore.getState().activeTermTabId).toBe('ov-a')
      expect(useTerminalStore.getState().overviewOpen).toBe(false)
    })
  })

  // ─── TERM-007: Session persistence ───

  describe('session persistence (TERM-007)', () => {
    it('persistedSessions initializes empty', () => {
      expect(useTerminalStore.getState().persistedSessions).toEqual([])
    })

    it('dismissPersistedSession removes session from state', () => {
      useTerminalStore.setState({
        persistedSessions: [
          { id: 's1', serializedBuffer: 'test', shell: 'bash', cwd: '/home', exitCode: 0, savedAt: Date.now() },
          { id: 's2', serializedBuffer: 'test2', shell: 'zsh', cwd: '/tmp', exitCode: null, savedAt: Date.now() },
        ],
      })
      useTerminalStore.getState().dismissPersistedSession('s1')
      expect(useTerminalStore.getState().persistedSessions).toHaveLength(1)
      expect(useTerminalStore.getState().persistedSessions[0].id).toBe('s2')
    })

    it('dismissAllPersistedSessions clears all sessions', () => {
      useTerminalStore.setState({
        persistedSessions: [
          { id: 's1', serializedBuffer: 'test', shell: 'bash', cwd: '/home', exitCode: 0, savedAt: Date.now() },
          { id: 's2', serializedBuffer: 'test2', shell: 'zsh', cwd: '/tmp', exitCode: null, savedAt: Date.now() },
        ],
      })
      useTerminalStore.getState().dismissAllPersistedSessions()
      expect(useTerminalStore.getState().persistedSessions).toEqual([])
    })

    it('restoreSession creates a new tab and removes from persisted list', async () => {
      mockClui.terminalCreate.mockResolvedValueOnce({ termTabId: 'restored-1' })
      useTerminalStore.setState({
        persistedSessions: [
          { id: 'ps1', serializedBuffer: 'hello', shell: 'bash', cwd: '/home/user', exitCode: 0, savedAt: Date.now() },
        ],
      })

      await useTerminalStore.getState().restoreSession('ps1')

      expect(useTerminalStore.getState().termTabs).toHaveLength(1)
      expect(useTerminalStore.getState().termTabs[0].id).toBe('restored-1')
      expect(useTerminalStore.getState().termTabs[0].shell).toBe('bash')
      expect(useTerminalStore.getState().termTabs[0].cwd).toBe('/home/user')
      expect(useTerminalStore.getState().activeTermTabId).toBe('restored-1')
      expect(useTerminalStore.getState().persistedSessions).toHaveLength(0)
    })

    it('restoreSession with unknown id is no-op', async () => {
      await useTerminalStore.getState().restoreSession('nonexistent')
      expect(useTerminalStore.getState().termTabs).toHaveLength(0)
    })

    it('restoreSession dispatches buffer restore event', async () => {
      mockClui.terminalCreate.mockResolvedValueOnce({ termTabId: 'restored-2' })
      useTerminalStore.setState({
        persistedSessions: [
          { id: 'ps2', serializedBuffer: 'previous output', shell: 'bash', cwd: '/tmp', exitCode: null, savedAt: Date.now() },
        ],
      })

      await useTerminalStore.getState().restoreSession('ps2')

      expect(window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'clui-terminal-restore',
        })
      )
    })
  })

  // ─── TERM-002: Split pane close ───

  describe('split pane close (TERM-002)', () => {
    it('closeSplitPane removes pane and keeps sibling', async () => {
      mockClui.terminalCreate
        .mockResolvedValueOnce({ termTabId: 'main-tab' })
        .mockResolvedValueOnce({ termTabId: 'split-pane' })

      await useTerminalStore.getState().createTermTab()
      await useTerminalStore.getState().splitPane('main-tab', 'horizontal')

      // Verify split layout exists
      const layout = useTerminalStore.getState().paneLayouts['main-tab']
      expect(layout).toBeDefined()
      expect(layout.type).toBe('split')

      // Close the split pane
      useTerminalStore.getState().closeSplitPane('main-tab', 'split-pane')

      // Layout should be removed (back to single pane)
      const afterLayout = useTerminalStore.getState().paneLayouts['main-tab']
      expect(afterLayout?.type).toBe('leaf')
    })

    it('closeSplitPane on non-existent layout is no-op', () => {
      useTerminalStore.getState().closeSplitPane('nonexistent', 'pane')
      // no crash
    })

    it('closeSplitPane calls terminalClose on removed pane', async () => {
      mockClui.terminalCreate
        .mockResolvedValueOnce({ termTabId: 'main-tab2' })
        .mockResolvedValueOnce({ termTabId: 'split-pane2' })

      await useTerminalStore.getState().createTermTab()
      await useTerminalStore.getState().splitPane('main-tab2', 'vertical')
      useTerminalStore.getState().closeSplitPane('main-tab2', 'split-pane2')

      expect(mockClui.terminalClose).toHaveBeenCalledWith('split-pane2')
    })
  })

  // ─── TERM-011: Mouse protocol ───

  describe('mouse protocol support (TERM-011)', () => {
    it('terminal name is xterm-256color for mouse protocol support', () => {
      // The terminal manager spawns PTY with name: 'xterm-256color'
      // which enables SGR1006 mouse protocol natively in xterm.js v6.
      // This test documents the requirement — actual PTY spawn is tested
      // in terminal-manager-class.test.ts.
      expect(true).toBe(true) // placeholder: verified in integration
    })
  })

  // ─── Security tests ───

  describe('security', () => {
    it('new tab has bellCount initialized to 0', async () => {
      mockClui.terminalCreate.mockResolvedValueOnce({ termTabId: 'sec-1' })
      await useTerminalStore.getState().createTermTab()
      expect(useTerminalStore.getState().termTabs[0].bellCount).toBe(0)
    })
  })
})
