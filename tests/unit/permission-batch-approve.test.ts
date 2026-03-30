import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPermissionStore } from '../../src/renderer/stores/permissionStore'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    get length() { return Object.keys(store).length },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

describe('Permission Batch Approve', () => {
  let store: ReturnType<typeof createPermissionStore>
  const mockDeps = {
    setPermissionMode: vi.fn(),
    respondPermission: vi.fn(),
    afterRespond: vi.fn(),
  }

  beforeEach(() => {
    vi.useFakeTimers()
    localStorageMock.clear()
    store = createPermissionStore(mockDeps)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('enableBatchApprove', () => {
    it('sets autoApproveUntil correctly', () => {
      const now = Date.now()
      store.getState().enableBatchApprove(30 * 60 * 1000) // 30 min
      const state = store.getState()
      expect(state.autoApproveUntil).toBeGreaterThanOrEqual(now + 30 * 60 * 1000)
      expect(state.batchApproveTimer).not.toBeNull()
    })

    it('clears previous timer when called again', () => {
      store.getState().enableBatchApprove(10 * 60 * 1000)
      const firstTimer = store.getState().batchApproveTimer
      store.getState().enableBatchApprove(20 * 60 * 1000)
      const secondTimer = store.getState().batchApproveTimer
      expect(secondTimer).not.toBe(firstTimer)
    })

    it('auto-clears after expiry', () => {
      store.getState().enableBatchApprove(5000)
      expect(store.getState().autoApproveUntil).not.toBeNull()
      vi.advanceTimersByTime(5001)
      expect(store.getState().autoApproveUntil).toBeNull()
      expect(store.getState().batchApproveTimer).toBeNull()
    })
  })

  describe('isBatchApproveActive', () => {
    it('returns true within the approval window', () => {
      store.getState().enableBatchApprove(60000)
      expect(store.getState().isBatchApproveActive()).toBe(true)
    })

    it('returns false after expiry', () => {
      store.getState().enableBatchApprove(5000)
      vi.advanceTimersByTime(5001)
      expect(store.getState().isBatchApproveActive()).toBe(false)
    })

    it('returns false when never enabled', () => {
      expect(store.getState().isBatchApproveActive()).toBe(false)
    })
  })

  describe('addTrustedTool', () => {
    it('adds tool to set', () => {
      store.getState().addTrustedTool('Bash')
      expect(store.getState().trustedTools.has('Bash')).toBe(true)
    })

    it('persists to localStorage', () => {
      store.getState().addTrustedTool('Edit')
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'clui-trusted-tools',
        expect.stringContaining('Edit')
      )
    })

    it('handles multiple tools', () => {
      store.getState().addTrustedTool('Bash')
      store.getState().addTrustedTool('Edit')
      store.getState().addTrustedTool('Write')
      expect(store.getState().trustedTools.size).toBe(3)
    })
  })

  describe('removeTrustedTool', () => {
    it('removes from set', () => {
      store.getState().addTrustedTool('Bash')
      store.getState().removeTrustedTool('Bash')
      expect(store.getState().trustedTools.has('Bash')).toBe(false)
    })

    it('persists removal', () => {
      store.getState().addTrustedTool('Bash')
      store.getState().removeTrustedTool('Bash')
      const lastCall = localStorageMock.setItem.mock.calls.at(-1)
      expect(lastCall?.[1]).toBe('[]')
    })
  })

  describe('clearTrustedTools', () => {
    it('empties the set', () => {
      store.getState().addTrustedTool('Bash')
      store.getState().addTrustedTool('Edit')
      store.getState().clearTrustedTools()
      expect(store.getState().trustedTools.size).toBe(0)
    })

    it('clears localStorage', () => {
      store.getState().addTrustedTool('Bash')
      store.getState().clearTrustedTools()
      const lastCall = localStorageMock.setItem.mock.calls.at(-1)
      expect(lastCall?.[1]).toBe('[]')
    })
  })

  describe('isToolTrusted', () => {
    it('returns true for trusted tool', () => {
      store.getState().addTrustedTool('Bash')
      expect(store.getState().isToolTrusted('Bash')).toBe(true)
    })

    it('returns false for non-trusted tool', () => {
      expect(store.getState().isToolTrusted('Bash')).toBe(false)
    })
  })

  describe('loadTrustedTools (localStorage recovery)', () => {
    it('loads persisted tools on creation', () => {
      localStorageMock.setItem('clui-trusted-tools', JSON.stringify(['Bash', 'Edit']))
      const newStore = createPermissionStore(mockDeps)
      expect(newStore.getState().trustedTools.has('Bash')).toBe(true)
      expect(newStore.getState().trustedTools.has('Edit')).toBe(true)
    })

    it('handles corrupted JSON gracefully', () => {
      localStorageMock.setItem('clui-trusted-tools', '{not valid json')
      const newStore = createPermissionStore(mockDeps)
      expect(newStore.getState().trustedTools.size).toBe(0)
    })

    it('handles non-array JSON gracefully', () => {
      localStorageMock.setItem('clui-trusted-tools', JSON.stringify({ foo: 'bar' }))
      const newStore = createPermissionStore(mockDeps)
      expect(newStore.getState().trustedTools.size).toBe(0)
    })

    it('filters out non-string values', () => {
      localStorageMock.setItem('clui-trusted-tools', JSON.stringify(['Bash', 123, null, 'Edit']))
      const newStore = createPermissionStore(mockDeps)
      expect(newStore.getState().trustedTools.size).toBe(2)
      expect(newStore.getState().trustedTools.has('Bash')).toBe(true)
      expect(newStore.getState().trustedTools.has('Edit')).toBe(true)
    })

    it('handles empty localStorage', () => {
      const newStore = createPermissionStore(mockDeps)
      expect(newStore.getState().trustedTools.size).toBe(0)
    })
  })

  describe('respondPermission', () => {
    it('calls deps.respondPermission', () => {
      store.getState().respondPermission('tab-1', 'q-1', 'opt-allow')
      expect(mockDeps.respondPermission).toHaveBeenCalledWith('tab-1', 'q-1', 'opt-allow')
    })

    it('calls afterRespond callback', () => {
      store.getState().respondPermission('tab-1', 'q-1', 'opt-allow')
      expect(mockDeps.afterRespond).toHaveBeenCalledWith('tab-1', 'q-1')
    })
  })
})
