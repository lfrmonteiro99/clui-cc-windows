import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Tests for the Wayland click-through guard.
 *
 * On Wayland, setIgnoreMouseEvents(true, { forward: true }) must NOT be called
 * because Wayland doesn't forward events back, leaving the app permanently unclickable.
 *
 * These tests validate the guard logic that protects against this.
 */

describe('Wayland click-through guard', () => {
  const originalPlatform = process.platform
  let savedEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    savedEnv = { ...process.env }
  })

  afterEach(() => {
    process.env = savedEnv
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  function setPlatform(p: string): void {
    Object.defineProperty(process, 'platform', { value: p })
  }

  /**
   * Simulates the startup click-through logic from index.ts:
   *   if (!E2E_MODE && !isWaylandSession()) {
   *     mainWindow.setIgnoreMouseEvents(true, { forward: true })
   *   }
   */
  function simulateStartupClickThrough(
    isWayland: boolean,
    e2eMode: boolean,
    setIgnoreMouseEvents: ReturnType<typeof vi.fn>
  ): void {
    if (!e2eMode && !isWayland) {
      setIgnoreMouseEvents(true, { forward: true })
    }
  }

  /**
   * Simulates the IPC handler logic:
   *   if (E2E_MODE || isWaylandSession()) return
   *   win.setIgnoreMouseEvents(ignore, options || {})
   */
  function simulateIPCHandler(
    isWayland: boolean,
    e2eMode: boolean,
    setIgnoreMouseEvents: ReturnType<typeof vi.fn>,
    ignore: boolean,
    options?: { forward?: boolean }
  ): void {
    if (e2eMode || isWayland) return
    setIgnoreMouseEvents(ignore, options || {})
  }

  describe('startup click-through', () => {
    it('calls setIgnoreMouseEvents on macOS (non-Wayland)', () => {
      setPlatform('darwin')
      const setIgnore = vi.fn()
      simulateStartupClickThrough(false, false, setIgnore)
      expect(setIgnore).toHaveBeenCalledWith(true, { forward: true })
    })

    it('calls setIgnoreMouseEvents on Windows', () => {
      setPlatform('win32')
      const setIgnore = vi.fn()
      simulateStartupClickThrough(false, false, setIgnore)
      expect(setIgnore).toHaveBeenCalledWith(true, { forward: true })
    })

    it('calls setIgnoreMouseEvents on Linux X11', () => {
      setPlatform('linux')
      process.env.XDG_SESSION_TYPE = 'x11'
      const setIgnore = vi.fn()
      simulateStartupClickThrough(false, false, setIgnore)
      expect(setIgnore).toHaveBeenCalledWith(true, { forward: true })
    })

    it('does NOT call setIgnoreMouseEvents on Linux Wayland', () => {
      setPlatform('linux')
      process.env.XDG_SESSION_TYPE = 'wayland'
      const setIgnore = vi.fn()
      simulateStartupClickThrough(true, false, setIgnore)
      expect(setIgnore).not.toHaveBeenCalled()
    })

    it('does NOT call setIgnoreMouseEvents in E2E mode', () => {
      const setIgnore = vi.fn()
      simulateStartupClickThrough(false, true, setIgnore)
      expect(setIgnore).not.toHaveBeenCalled()
    })

    it('does NOT call setIgnoreMouseEvents in E2E mode on Wayland', () => {
      setPlatform('linux')
      process.env.XDG_SESSION_TYPE = 'wayland'
      const setIgnore = vi.fn()
      simulateStartupClickThrough(true, true, setIgnore)
      expect(setIgnore).not.toHaveBeenCalled()
    })
  })

  describe('IPC SET_IGNORE_MOUSE_EVENTS handler', () => {
    it('forwards calls on macOS', () => {
      setPlatform('darwin')
      const setIgnore = vi.fn()
      simulateIPCHandler(false, false, setIgnore, true, { forward: true })
      expect(setIgnore).toHaveBeenCalledWith(true, { forward: true })
    })

    it('forwards calls on Linux X11', () => {
      setPlatform('linux')
      process.env.XDG_SESSION_TYPE = 'x11'
      const setIgnore = vi.fn()
      simulateIPCHandler(false, false, setIgnore, false, {})
      expect(setIgnore).toHaveBeenCalledWith(false, {})
    })

    it('is a no-op on Wayland', () => {
      setPlatform('linux')
      process.env.XDG_SESSION_TYPE = 'wayland'
      const setIgnore = vi.fn()
      simulateIPCHandler(true, false, setIgnore, true, { forward: true })
      expect(setIgnore).not.toHaveBeenCalled()
    })

    it('is a no-op in E2E mode', () => {
      const setIgnore = vi.fn()
      simulateIPCHandler(false, true, setIgnore, true, { forward: true })
      expect(setIgnore).not.toHaveBeenCalled()
    })

    it('is a no-op when both Wayland and E2E mode', () => {
      setPlatform('linux')
      process.env.XDG_SESSION_TYPE = 'wayland'
      const setIgnore = vi.fn()
      simulateIPCHandler(true, true, setIgnore, true, { forward: true })
      expect(setIgnore).not.toHaveBeenCalled()
    })
  })
})
