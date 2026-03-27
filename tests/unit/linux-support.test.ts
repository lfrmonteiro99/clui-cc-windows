import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mockPlatform } from '../helpers/mock-platform'

describe('linux-support', () => {
  let restorePlatform: (() => void) | null = null
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    restorePlatform?.()
    restorePlatform = null
    // Restore env
    process.env = { ...originalEnv }
  })

  describe('isWaylandSession', () => {
    let isWaylandSession: () => boolean

    beforeEach(async () => {
      const mod = await import('../../src/main/linux-support')
      isWaylandSession = mod.isWaylandSession
    })

    it('returns true when XDG_SESSION_TYPE is wayland', () => {
      restorePlatform = mockPlatform('linux')
      process.env.XDG_SESSION_TYPE = 'wayland'

      expect(isWaylandSession()).toBe(true)
    })

    it('returns false when XDG_SESSION_TYPE is x11', () => {
      restorePlatform = mockPlatform('linux')
      process.env.XDG_SESSION_TYPE = 'x11'

      expect(isWaylandSession()).toBe(false)
    })

    it('returns false when XDG_SESSION_TYPE is not set', () => {
      restorePlatform = mockPlatform('linux')
      delete process.env.XDG_SESSION_TYPE

      expect(isWaylandSession()).toBe(false)
    })

    it('returns false on macOS even if XDG_SESSION_TYPE is wayland', () => {
      restorePlatform = mockPlatform('darwin')
      process.env.XDG_SESSION_TYPE = 'wayland'

      expect(isWaylandSession()).toBe(false)
    })

    it('returns false on Windows', () => {
      restorePlatform = mockPlatform('win32')

      expect(isWaylandSession()).toBe(false)
    })
  })

  describe('registerGlobalShortcutSafe', () => {
    let registerGlobalShortcutSafe: typeof import('../../src/main/linux-support').registerGlobalShortcutSafe

    beforeEach(async () => {
      const mod = await import('../../src/main/linux-support')
      registerGlobalShortcutSafe = mod.registerGlobalShortcutSafe
    })

    it('returns true when registration succeeds', () => {
      restorePlatform = mockPlatform('linux')
      delete process.env.XDG_SESSION_TYPE

      const registerFn = vi.fn(() => true)
      const logFn = vi.fn()

      const result = registerGlobalShortcutSafe('Alt+Space', vi.fn(), registerFn, logFn)

      expect(result).toBe(true)
      expect(registerFn).toHaveBeenCalledWith('Alt+Space', expect.any(Function))
    })

    it('returns false when registration returns false', () => {
      restorePlatform = mockPlatform('linux')
      delete process.env.XDG_SESSION_TYPE

      const registerFn = vi.fn(() => false)
      const logFn = vi.fn()

      const result = registerGlobalShortcutSafe('Alt+Space', vi.fn(), registerFn, logFn)

      expect(result).toBe(false)
    })

    it('catches exception on Wayland and returns false without crashing', () => {
      restorePlatform = mockPlatform('linux')
      process.env.XDG_SESSION_TYPE = 'wayland'

      const registerFn = vi.fn(() => { throw new Error('Wayland: global shortcuts not supported') })
      const logFn = vi.fn()

      const result = registerGlobalShortcutSafe('Alt+Space', vi.fn(), registerFn, logFn)

      expect(result).toBe(false)
    })

    it('logs a helpful warning when registration throws on Wayland', () => {
      restorePlatform = mockPlatform('linux')
      process.env.XDG_SESSION_TYPE = 'wayland'

      const registerFn = vi.fn(() => { throw new Error('Wayland: global shortcuts not supported') })
      const logFn = vi.fn()

      registerGlobalShortcutSafe('Alt+Space', vi.fn(), registerFn, logFn)

      expect(logFn).toHaveBeenCalledWith(
        expect.stringContaining('Wayland')
      )
    })

    it('logs warning mentioning the shortcut accelerator on Wayland failure', () => {
      restorePlatform = mockPlatform('linux')
      process.env.XDG_SESSION_TYPE = 'wayland'

      const registerFn = vi.fn(() => { throw new Error('fail') })
      const logFn = vi.fn()

      registerGlobalShortcutSafe('Ctrl+Shift+K', vi.fn(), registerFn, logFn)

      expect(logFn).toHaveBeenCalledWith(
        expect.stringContaining('Ctrl+Shift+K')
      )
    })

    it('re-throws exception on non-Wayland Linux (not silenced)', () => {
      restorePlatform = mockPlatform('linux')
      process.env.XDG_SESSION_TYPE = 'x11'

      const registerFn = vi.fn(() => { throw new Error('unexpected error') })
      const logFn = vi.fn()

      expect(() =>
        registerGlobalShortcutSafe('Alt+Space', vi.fn(), registerFn, logFn)
      ).toThrow('unexpected error')
    })

    it('works normally on non-Linux platforms', () => {
      restorePlatform = mockPlatform('darwin')

      const registerFn = vi.fn(() => true)
      const logFn = vi.fn()

      const result = registerGlobalShortcutSafe('Alt+Space', vi.fn(), registerFn, logFn)

      expect(result).toBe(true)
    })
  })

  describe('applyLinuxWorkspaceVisibility', () => {
    let applyLinuxWorkspaceVisibility: typeof import('../../src/main/linux-support').applyLinuxWorkspaceVisibility

    beforeEach(async () => {
      const mod = await import('../../src/main/linux-support')
      applyLinuxWorkspaceVisibility = mod.applyLinuxWorkspaceVisibility
    })

    it('calls setVisibleOnAllWorkspaces(true) on Linux', () => {
      restorePlatform = mockPlatform('linux')

      const mockWindow = { setVisibleOnAllWorkspaces: vi.fn() }

      applyLinuxWorkspaceVisibility(mockWindow as any)

      expect(mockWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true)
    })

    it('does not call setVisibleOnAllWorkspaces on macOS', () => {
      restorePlatform = mockPlatform('darwin')

      const mockWindow = { setVisibleOnAllWorkspaces: vi.fn() }

      applyLinuxWorkspaceVisibility(mockWindow as any)

      expect(mockWindow.setVisibleOnAllWorkspaces).not.toHaveBeenCalled()
    })

    it('does not call setVisibleOnAllWorkspaces on Windows', () => {
      restorePlatform = mockPlatform('win32')

      const mockWindow = { setVisibleOnAllWorkspaces: vi.fn() }

      applyLinuxWorkspaceVisibility(mockWindow as any)

      expect(mockWindow.setVisibleOnAllWorkspaces).not.toHaveBeenCalled()
    })
  })
})
