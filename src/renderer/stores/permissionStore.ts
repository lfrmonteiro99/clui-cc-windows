import { create } from 'zustand'

interface PermissionDeps {
  setPermissionMode: (mode: 'ask' | 'auto') => void
  respondPermission: (tabId: string, questionId: string, optionId: string) => Promise<boolean> | boolean
  afterRespond?: (tabId: string, questionId: string) => void
}

const defaultPermissionDeps: PermissionDeps = {
  setPermissionMode: (mode) => window.clui.setPermissionMode(mode),
  respondPermission: (tabId, questionId, optionId) => window.clui.respondPermission(tabId, questionId, optionId),
}

const TRUSTED_TOOLS_KEY = 'clui-trusted-tools'

function loadTrustedTools(): string[] {
  try {
    const raw = localStorage.getItem(TRUSTED_TOOLS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t: unknown) => typeof t === 'string') : []
  } catch (err) {
    console.warn('[permissionStore] loadTrustedTools failed:', err)
    return []
  }
}

function saveTrustedTools(tools: string[]): void {
  try {
    localStorage.setItem(TRUSTED_TOOLS_KEY, JSON.stringify(tools))
  } catch (err) {
    console.warn('[permissionStore] saveTrustedTools failed:', err)
  }
}

export interface PermissionStoreState {
  permissionMode: 'ask' | 'auto'
  setPermissionMode: (mode: 'ask' | 'auto') => void
  respondPermission: (tabId: string, questionId: string, optionId: string) => void

  // Batch approve (time-scoped)
  trustedTools: Set<string>
  autoApproveUntil: number | null
  batchApproveTimer: ReturnType<typeof setTimeout> | null

  enableBatchApprove: (durationMs: number) => void
  addTrustedTool: (toolName: string) => void
  removeTrustedTool: (toolName: string) => void
  clearTrustedTools: () => void
  isToolTrusted: (toolName: string) => boolean
  isBatchApproveActive: () => boolean
}

export function configurePermissionStore(overrides: Partial<PermissionDeps>): void {
  Object.assign(defaultPermissionDeps, overrides)
}

export function createPermissionStore(deps: PermissionDeps = defaultPermissionDeps) {
  return create<PermissionStoreState>((set, get) => ({
    permissionMode: 'ask',
    setPermissionMode: (mode) => {
      set({ permissionMode: mode })
      deps.setPermissionMode(mode)
    },
    respondPermission: (tabId, questionId, optionId) => {
      void deps.respondPermission(tabId, questionId, optionId)
      deps.afterRespond?.(tabId, questionId)
    },

    // Batch approve state
    trustedTools: new Set(loadTrustedTools()),
    autoApproveUntil: null,
    batchApproveTimer: null,

    enableBatchApprove: (durationMs: number) => {
      const { batchApproveTimer } = get()
      if (batchApproveTimer !== null) {
        clearTimeout(batchApproveTimer)
      }
      const timer = setTimeout(() => {
        set({ autoApproveUntil: null, batchApproveTimer: null })
      }, durationMs)
      set({
        autoApproveUntil: Date.now() + durationMs,
        batchApproveTimer: timer,
      })
    },

    addTrustedTool: (toolName: string) => {
      const { trustedTools } = get()
      const updated = new Set(trustedTools)
      updated.add(toolName)
      set({ trustedTools: updated })
      saveTrustedTools([...updated])
    },

    removeTrustedTool: (toolName: string) => {
      const { trustedTools } = get()
      const updated = new Set(trustedTools)
      updated.delete(toolName)
      set({ trustedTools: updated })
      saveTrustedTools([...updated])
    },

    clearTrustedTools: () => {
      set({ trustedTools: new Set() })
      saveTrustedTools([])
    },

    isToolTrusted: (toolName: string) => {
      return get().trustedTools.has(toolName)
    },

    isBatchApproveActive: () => {
      const { autoApproveUntil } = get()
      return autoApproveUntil !== null && Date.now() < autoApproveUntil
    },
  }))
}

export const usePermissionStore = createPermissionStore()
