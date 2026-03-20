import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WslStatus } from '../../src/shared/types'

const mockWslStatus = vi.fn<() => Promise<WslStatus>>()
const mockWslCheckClaude = vi.fn<(distro: string) => Promise<boolean>>()
const mockWslBrowse = vi.fn<(distro: string) => Promise<string | null>>()

const sampleStatus: WslStatus = {
  available: true,
  distros: [
    { name: 'Ubuntu', isDefault: true, state: 'Running', version: 2, hasClaude: null },
    { name: 'Debian', isDefault: false, state: 'Stopped', version: 1, hasClaude: null },
  ],
}

describe('wslStore', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    // Mock window.clui globally
    Object.defineProperty(globalThis, 'window', {
      value: {
        clui: {
          wslStatus: mockWslStatus,
          wslCheckClaude: mockWslCheckClaude,
          wslBrowse: mockWslBrowse,
        },
      },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  async function loadStore() {
    const mod = await import('../../src/renderer/stores/wslStore')
    return mod.useWslStore
  }

  it('initializes with available=false and empty distros', async () => {
    const useWslStore = await loadStore()
    const state = useWslStore.getState()

    expect(state.available).toBe(false)
    expect(state.distros).toEqual([])
    expect(state.initialized).toBe(false)
  })

  it('fetches WSL status on init', async () => {
    mockWslStatus.mockResolvedValue(sampleStatus)
    const useWslStore = await loadStore()

    await useWslStore.getState().init()

    const state = useWslStore.getState()
    expect(state.available).toBe(true)
    expect(state.distros).toHaveLength(2)
    expect(state.distros[0].name).toBe('Ubuntu')
    expect(state.distros[0].isDefault).toBe(true)
    expect(state.distros[1].name).toBe('Debian')
    expect(state.initialized).toBe(true)
    expect(mockWslStatus).toHaveBeenCalledTimes(1)
  })

  it('does not refetch if already initialized', async () => {
    mockWslStatus.mockResolvedValue(sampleStatus)
    const useWslStore = await loadStore()

    await useWslStore.getState().init()
    await useWslStore.getState().init()

    expect(mockWslStatus).toHaveBeenCalledTimes(1)
  })

  it('handles init failure gracefully', async () => {
    mockWslStatus.mockRejectedValue(new Error('IPC failure'))
    const useWslStore = await loadStore()

    await useWslStore.getState().init()

    const state = useWslStore.getState()
    expect(state.available).toBe(false)
    expect(state.distros).toEqual([])
    expect(state.initialized).toBe(true)
  })

  it('checks claude availability per distro lazily', async () => {
    mockWslStatus.mockResolvedValue(sampleStatus)
    mockWslCheckClaude.mockResolvedValue(true)
    const useWslStore = await loadStore()

    await useWslStore.getState().init()

    // hasClaude is null before check
    expect(useWslStore.getState().distros[0].hasClaude).toBe(null)

    const result = await useWslStore.getState().checkClaude('Ubuntu')

    expect(result).toBe(true)
    expect(mockWslCheckClaude).toHaveBeenCalledWith('Ubuntu')
    expect(useWslStore.getState().distros[0].hasClaude).toBe(true)
    // Other distros remain unchecked
    expect(useWslStore.getState().distros[1].hasClaude).toBe(null)
  })

  it('handles checkClaude returning false', async () => {
    mockWslStatus.mockResolvedValue(sampleStatus)
    mockWslCheckClaude.mockResolvedValue(false)
    const useWslStore = await loadStore()

    await useWslStore.getState().init()
    const result = await useWslStore.getState().checkClaude('Debian')

    expect(result).toBe(false)
    expect(useWslStore.getState().distros[1].hasClaude).toBe(false)
  })

  it('handles checkClaude failure gracefully', async () => {
    mockWslStatus.mockResolvedValue(sampleStatus)
    mockWslCheckClaude.mockRejectedValue(new Error('timeout'))
    const useWslStore = await loadStore()

    await useWslStore.getState().init()
    const result = await useWslStore.getState().checkClaude('Ubuntu')

    expect(result).toBe(false)
    expect(useWslStore.getState().distros[0].hasClaude).toBe(false)
  })

  it('returns default distro name', async () => {
    mockWslStatus.mockResolvedValue(sampleStatus)
    const useWslStore = await loadStore()

    await useWslStore.getState().init()

    expect(useWslStore.getState().getDefaultDistro()).toBe('Ubuntu')
  })

  it('returns null when no default distro exists', async () => {
    mockWslStatus.mockResolvedValue({
      available: true,
      distros: [
        { name: 'Ubuntu', isDefault: false, state: 'Running', version: 2, hasClaude: null },
      ],
    })
    const useWslStore = await loadStore()

    await useWslStore.getState().init()

    expect(useWslStore.getState().getDefaultDistro()).toBe(null)
  })

  it('returns null for getDefaultDistro when not initialized', async () => {
    const useWslStore = await loadStore()
    expect(useWslStore.getState().getDefaultDistro()).toBe(null)
  })

  it('browseWsl delegates to window.clui.wslBrowse', async () => {
    mockWslBrowse.mockResolvedValue('/home/user/project')
    const useWslStore = await loadStore()

    const result = await useWslStore.getState().browseWsl('Ubuntu')

    expect(result).toBe('/home/user/project')
    expect(mockWslBrowse).toHaveBeenCalledWith('Ubuntu')
  })

  it('browseWsl returns null on failure', async () => {
    mockWslBrowse.mockRejectedValue(new Error('cancelled'))
    const useWslStore = await loadStore()

    const result = await useWslStore.getState().browseWsl('Ubuntu')

    expect(result).toBe(null)
  })
})
