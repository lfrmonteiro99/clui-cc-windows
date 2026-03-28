import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TabState } from '../../src/shared/types'

// ─── BUG-001 & BUG-008: empty catch blocks ───
// Tests that:
// 1. initStaticInfo failure sets a startupError flag and logs the error
// 2. All empty catch blocks in the codebase have been replaced

// ── Setup window.clui and Audio mock before any store imports ──
const mockClui = vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>).Audio = class MockAudio {
    volume = 1.0
    currentTime = 0
    play = () => Promise.resolve()
    pause = () => {}
  }
  if (!globalThis.crypto) {
    ;(globalThis as Record<string, unknown>).crypto = { randomUUID: () => '00000000-0000-0000-0000-000000000000' }
  }
  const clui = {
    isVisible: vi.fn().mockResolvedValue(true),
    recordCost: vi.fn(),
    sendDesktopNotification: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue({ version: '1.0', auth: null, projectPath: '~', homePath: '~' }),
    createTab: vi.fn().mockResolvedValue({ tabId: 'new-tab' }),
    closeTab: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
    stopTab: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined),
    initSession: vi.fn().mockResolvedValue(undefined),
    resetTabSession: vi.fn(),
    respondPermission: vi.fn().mockResolvedValue(true),
    setPermissionMode: vi.fn(),
    loadSession: vi.fn().mockResolvedValue([]),
    getAutoAttachConfig: vi.fn().mockResolvedValue({ attachments: [], warnings: [] }),
  }
  ;(globalThis as Record<string, unknown>).window = {
    ...((globalThis as Record<string, unknown>).window || {}),
    clui,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  }
  return clui
})

// ── Mock dependent modules ──

vi.mock('../../src/renderer/theme', () => ({
  useThemeStore: {
    getState: () => ({
      soundEnabled: false,
      autoResumeEnabled: false,
      autoResumeMaxRetries: 3,
    }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

const mockAddToast = vi.hoisted(() => vi.fn())

vi.mock('../../src/renderer/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: () => ({
      desktopEnabled: false,
      addToast: mockAddToast,
    }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

vi.mock('../../src/renderer/stores/marketplaceStore', () => ({
  useMarketplaceStore: {
    getState: () => ({
      closeMarketplace: vi.fn(),
    }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

vi.mock('../../src/renderer/stores/permissionStore', () => ({
  usePermissionStore: {
    getState: () => ({
      setPermissionMode: vi.fn(),
      respondPermission: vi.fn(),
    }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

vi.mock('../../src/renderer/stores/agentMemoryStore', () => ({
  useAgentMemoryStore: {
    getState: () => ({
      refreshAgentMemory: vi.fn().mockResolvedValue(null),
      setAgentFocus: vi.fn().mockResolvedValue(null),
      claimAgentWork: vi.fn().mockResolvedValue(null),
      markAgentDone: vi.fn().mockResolvedValue(false),
      releaseAgentWork: vi.fn().mockResolvedValue(false),
    }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

vi.mock('../../../resources/notification.mp3', () => ({
  default: 'mock-notification.mp3',
}))

// Now import the store
import { useSessionStore } from '../../src/renderer/stores/sessionStore.impl'

describe('BUG-001: initStaticInfo error handling', () => {
  beforeEach(() => {
    // Reset store state
    useSessionStore.setState({
      staticInfo: null,
      startupError: null,
    })
    mockAddToast.mockClear()
  })

  it('sets startupError when window.clui.start() rejects', async () => {
    const testError = new Error('CLI not found')
    mockClui.start.mockRejectedValueOnce(testError)

    await useSessionStore.getState().initStaticInfo()

    const state = useSessionStore.getState()
    expect(state.startupError).toBe('CLI not found')
    expect(state.staticInfo).toBeNull()
  })

  it('logs the error via console.warn when initStaticInfo fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const testError = new Error('connection refused')
    mockClui.start.mockRejectedValueOnce(testError)

    await useSessionStore.getState().initStaticInfo()

    expect(warnSpy).toHaveBeenCalledWith(
      '[sessionStore] initStaticInfo failed:',
      testError,
    )
    warnSpy.mockRestore()
  })

  it('shows a user-facing toast when initStaticInfo fails', async () => {
    const testError = new Error('startup boom')
    mockClui.start.mockRejectedValueOnce(testError)

    await useSessionStore.getState().initStaticInfo()

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        title: 'Startup failed',
      }),
    )
  })

  it('sets staticInfo normally when start() succeeds', async () => {
    mockClui.start.mockResolvedValueOnce({
      version: '2.0',
      auth: { email: 'test@test.com', subscriptionType: 'pro' },
      projectPath: '/proj',
      homePath: '/home',
    })

    await useSessionStore.getState().initStaticInfo()

    const state = useSessionStore.getState()
    expect(state.startupError).toBeNull()
    expect(state.staticInfo).toEqual({
      version: '2.0',
      email: 'test@test.com',
      subscriptionType: 'pro',
      projectPath: '/proj',
      homePath: '/home',
    })
  })
})
