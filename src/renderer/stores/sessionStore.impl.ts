import { createWithEqualityFn as create } from 'zustand/traditional'
import type {
  TabStatus,
  NormalizedEvent,
  EnrichedError,
  Message,
  TabState,
  Attachment,
  CatalogPlugin,
  PluginStatus,
  RunOptions,
  AgentAssignment,
  AgentMemorySnapshot,
  AgentMemoryClaimResult,
} from '../../shared/types'
import { useModelRouterStore } from './modelRouterStore'
import { useBudgetStore } from './budgetStore'
import { canScheduleAutoResume, DEFAULT_AUTO_RESUME_MAX_RETRIES, getAutoResumeDelayMs } from '../../shared/retry-policy'
import { useThemeStore } from '../theme'
import { useNotificationStore } from './notificationStore'
import { usePermissionStore } from './permissionStore'
import { useMarketplaceStore } from './marketplaceStore'
import { usePermissionStore } from './permissionStore'
import { useAgentMemoryStore } from './agentMemoryStore'
import { useTokenBudgetStore } from './tokenBudgetStore'
import { useFaultMemoryStore } from './faultMemoryStore'
import { useSandboxStore } from './sandboxStore'
import { detectCorrection } from '../../shared/fault-detector'
import { detectContentType } from '../../shared/content-detect'
import { analyzeForPruning } from '../../shared/context-pruner'
import {
  loadStoredTabOrder,
  moveTabOrderItem,
  orderTabsByTabOrder,
  reconcileTabOrder,
  replaceTabOrderId,
  saveStoredTabOrder,
} from './tabOrder'
import { saveChatSession, loadChatSessions, deleteChatSession, purgeOldSessions } from '../utils/session-persistence'
import notificationSrc from '../../../resources/notification.mp3'

// ─── Known models ───

export const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const

// ─── Store ───

interface StaticInfo {
  version: string
  email: string | null
  subscriptionType: string | null
  projectPath: string
  homePath: string
}

export interface State {
  tabs: TabState[]
  tabOrder: string[]
  activeTabId: string
  /** Global expand/collapse — user-controlled, not per-tab */
  isExpanded: boolean
  /** Global info fetched on startup (not per-session) */
  staticInfo: StaticInfo | null
  /** Error message if initStaticInfo failed (null = no error) */
  startupError: string | null
  agentMemorySnapshot: AgentMemorySnapshot | null
  /** User's preferred model override (null = use default) */
  preferredModel: string | null
  /** Global permission mode: 'ask' shows cards, 'auto' auto-approves all tool calls */
  permissionMode: 'ask' | 'auto'

  // Marketplace state
  marketplaceOpen: boolean
  marketplaceCatalog: CatalogPlugin[]
  marketplaceLoading: boolean
  marketplaceError: string | null
  marketplaceInstalledNames: string[]
  marketplacePluginStates: Record<string, PluginStatus>
  marketplaceSearch: string
  marketplaceFilter: string

  // Cost dashboard state
  costDashboardOpen: boolean

  // Compose editor per-tab drafts
  composeDrafts: Record<string, string>

  // Actions
  initStaticInfo: () => Promise<void>
  setPreferredModel: (model: string | null) => void
  setPermissionMode: (mode: 'ask' | 'auto') => void
  createTab: () => Promise<string>
  reorderTabs: (newOrder: string[]) => void
  moveActiveTab: (direction: 'left' | 'right') => void
  selectTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  clearTab: () => void
  toggleExpanded: () => void
  toggleMarketplace: () => void
  closeMarketplace: () => void
  toggleCostDashboard: () => void
  closeCostDashboard: () => void
  loadMarketplace: (forceRefresh?: boolean) => Promise<void>
  setMarketplaceSearch: (query: string) => void
  setMarketplaceFilter: (filter: string) => void
  installMarketplacePlugin: (plugin: CatalogPlugin) => Promise<void>
  uninstallMarketplacePlugin: (plugin: CatalogPlugin) => Promise<void>
  buildYourOwn: () => void
  resumeSession: (sessionId: string, title?: string, projectPath?: string) => Promise<string>
  addSystemMessage: (content: string) => void
  dismissCompanionMessage: (messageId: string) => void
  sendMessage: (prompt: string, projectPath?: string) => void
  respondPermission: (tabId: string, questionId: string, optionId: string) => void
  addDirectory: (dir: string) => void
  removeDirectory: (dir: string) => void
  setBaseDirectory: (dir: string) => void
  addAttachments: (attachments: Attachment[]) => void
  removeAttachment: (attachmentId: string) => void
  clearAttachments: () => void
  refreshAgentMemory: (projectPath?: string) => Promise<AgentMemorySnapshot | null>
  setAgentFocus: (summary: string) => Promise<AgentAssignment | null>
  claimAgentWork: (workKey: string, summary: string) => Promise<AgentMemoryClaimResult | null>
  markAgentDone: (note?: string) => Promise<boolean>
  releaseAgentWork: () => Promise<boolean>
  renameTab: (tabId: string, title: string) => void
  setTabGroup: (tabId: string, groupId: string | undefined) => void
  setComposeDraft: (tabId: string, draft: string) => void
  clearComposeDraft: (tabId: string) => void
  retryTab: (tabId: string) => void
  stopRetrying: (tabId: string) => void
  forkTabCreated: (newTabId: string, sourceTabId: string, parentTitle: string, workingDirectory: string, parentSessionId: string) => void
  prTabCreated: (newTabId: string, prNumber: number, workingDirectory: string) => void
  agentTabCreated: (newTabId: string, parentTabId: string, agentName: string, workingDirectory: string) => void
  handleNormalizedEvent: (tabId: string, event: NormalizedEvent) => void
  handleStatusChange: (tabId: string, newStatus: string, oldStatus: string) => void
  handleError: (tabId: string, error: EnrichedError) => void
}

let msgCounter = 0
const nextMsgId = () => `msg-${++msgCounter}`
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Maximum number of messages kept in memory per tab.
 * Older messages are pruned to prevent unbounded heap growth during long sessions.
 * The ConversationView already paginates rendering, so this is a safety net.
 */
const MAX_MESSAGES_PER_TAB = 2000

/** Prune messages array if it exceeds the limit, keeping the most recent ones. */
function pruneMessages(messages: Message[]): Message[] {
  if (messages.length <= MAX_MESSAGES_PER_TAB) return messages
  return messages.slice(messages.length - MAX_MESSAGES_PER_TAB)
}

/** Maximum queued prompts per tab (backpressure) */
const MAX_QUEUED_PROMPTS = 20

function clearRetryTimer(tabId: string) {
  const timer = retryTimers.get(tabId)
  if (timer) {
    clearTimeout(timer)
    retryTimers.delete(tabId)
  }
}

// ─── Debounced session persistence (#313) ───

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function debouncedSave(tabId: string) {
  const existing = saveTimers.get(tabId)
  if (existing) clearTimeout(existing)
  saveTimers.set(tabId, setTimeout(() => {
    saveTimers.delete(tabId)
    const tab = useSessionStore.getState().tabs.find((t) => t.id === tabId)
    if (tab && tab.messages.length > 0) {
      saveChatSession({
        tabId,
        claudeSessionId: tab.claudeSessionId ?? null,
        messages: tab.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp })),
        title: tab.title || 'Untitled',
        workingDirectory: tab.workingDirectory || '',
        savedAt: Date.now(),
      }).catch(() => {}) // non-blocking
    }
  }, 500))
}

/**
 * Returns the effective text content of a message.
 * During streaming, text is buffered in `_textChunks` to avoid O(n²) string
 * concatenation. Call this helper wherever you need the final readable string.
 */
export function getMessageContent(msg: Message): string {
  if (msg._textChunks && msg._textChunks.length > 0) {
    return msg._textChunks.join('')
  }
  return msg.content
}

/**
 * Flush any buffered `_textChunks` in a messages array into `content` and
 * delete the temporary accumulator. Called once per run completion so that
 * persisted/exported messages have a plain `content` string.
 */
function flushTextChunks(messages: Message[]): Message[] {
  let dirty = false
  for (const m of messages) {
    if (m._textChunks && m._textChunks.length > 0) {
      dirty = true
      break
    }
  }
  if (!dirty) return messages
  return messages.map((m) => {
    if (!m._textChunks || m._textChunks.length === 0) return m
    const { _textChunks, ...rest } = m
    return { ...rest, content: _textChunks.join('') }
  })
}

function getResolvedProjectPath(tab: TabState | undefined, staticInfo: StaticInfo | null): string {
  if (!tab) {
    return staticInfo?.homePath || '~'
  }

  return tab.hasChosenDirectory
    ? tab.workingDirectory
    : (staticInfo?.homePath || tab.workingDirectory || '~')
}

function getAgentLabel(tabId: string, tabs: TabState[]): string {
  const index = tabs.findIndex((tab) => tab.id === tabId)
  return index === -1 ? `Tab ${tabId.slice(0, 8)}` : `Tab ${index + 1}`
}

/** Find the last index in an array matching a predicate (like Array.findIndex but from the end). */
function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i
  }
  return -1
}

function inferFocusSummary(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 120) {
    return normalized
  }
  return `${normalized.slice(0, 119).trimEnd()}…`
}

function applyAgentMemorySnapshotToTabs(
  tabs: TabState[],
  snapshot: AgentMemorySnapshot | null,
  staticInfo: StaticInfo | null,
): TabState[] {
  if (!snapshot) {
    return tabs
  }

  return tabs.map((tab) => {
    const tabProjectPath = getResolvedProjectPath(tab, staticInfo)
    if (tabProjectPath !== snapshot.projectPath) {
      return tab
    }

    return {
      ...tab,
      agentAssignment: snapshot.active.find((assignment) => assignment.tabId === tab.id) || null,
    }
  })
}

// ─── Notification sound (plays when task completes while window is hidden) ───
const notificationAudio = new Audio(notificationSrc)
notificationAudio.volume = 1.0

async function playNotificationIfHidden(): Promise<void> {
  if (!useThemeStore.getState().soundEnabled) return
  try {
    const visible = await window.clui.isVisible()
    if (!visible) {
      notificationAudio.currentTime = 0
      notificationAudio.play().catch((err) => { console.warn('[sessionStore] notification playback failed:', err) })
    }
  } catch (err) {
    console.warn('[sessionStore] playNotificationIfHidden failed:', err)
  }
}

function makeLocalTab(): TabState {
  return {
    id: crypto.randomUUID(),
    claudeSessionId: null,
    status: 'idle',
    activeRequestId: null,
    hasUnread: false,
    currentActivity: '',
    permissionQueue: [],
    permissionDenied: null,
    retryState: null,
    agentAssignment: null,
    lastRunOptions: null,
    queuedRunOptions: [],
    attachments: [],
    messages: [],
    title: 'New Tab',
    lastResult: null,
    sessionModel: null,
    sessionTools: [],
    sessionMcpServers: [],
    sessionSkills: [],
    sessionVersion: null,
    queuedPrompts: [],
    workingDirectory: '~',
    hasChosenDirectory: false,
    additionalDirs: [],
    runtime: 'native',
    wslDistro: null,
    lastActivityAt: 0,
    sandboxState: { enabled: false, activeWorktree: null, pendingDiff: null, mergeStatus: 'idle' as const },
    tokenUsage: null,
    contextNotificationShown: false,
  }
}

const initialTab = makeLocalTab()
const initialTabOrder = reconcileTabOrder(loadStoredTabOrder(), [initialTab])

export const useSessionStore = create<State>((set, get) => ({
  tabs: orderTabsByTabOrder([initialTab], initialTabOrder),
  tabOrder: initialTabOrder,
  activeTabId: initialTab.id,
  isExpanded: false,
  staticInfo: null,
  startupError: null,
  agentMemorySnapshot: null,
  preferredModel: null,
  permissionMode: 'ask',

  // Marketplace
  marketplaceOpen: false,
  marketplaceCatalog: [],
  marketplaceLoading: false,
  marketplaceError: null,
  marketplaceInstalledNames: [],
  marketplacePluginStates: {},
  marketplaceSearch: '',
  marketplaceFilter: 'All',

  // Cost dashboard
  costDashboardOpen: false,

  // Compose editor drafts
  composeDrafts: {},

  initStaticInfo: async () => {
    try {
      const result = await window.clui.start()
      set({
        staticInfo: {
          version: result.version || 'unknown',
          email: result.auth?.email || null,
          subscriptionType: result.auth?.subscriptionType || null,
          projectPath: result.projectPath || '~',
          homePath: result.homePath || '~',
        },
      })
      void get().refreshAgentMemory(result.projectPath || result.homePath || '~')
    } catch (err) {
      console.warn('[sessionStore] initStaticInfo failed:', err)
      set({ startupError: err instanceof Error ? err.message : String(err) })
      useNotificationStore.getState().addToast({
        type: 'error',
        title: 'Startup failed',
        message: 'Could not connect to Claude CLI. Check that it is installed and on your PATH.',
      })
    }
  },

  setPreferredModel: (model) => {
    set({ preferredModel: model })
  },

  setPermissionMode: (mode) => {
    set({ permissionMode: mode })
    usePermissionStore.getState().setPermissionMode(mode)
  },

  createTab: async () => {
    const homeDir = get().staticInfo?.homePath || '~'
    const defaultDir = homeDir
    try {
      const { tabId } = await window.clui.createTab()
      const tab: TabState = {
        ...makeLocalTab(),
        id: tabId,
        workingDirectory: homeDir,
      }
      set((s) => ({
        tabs: orderTabsByTabOrder([...s.tabs, tab], [...s.tabOrder, tab.id]),
        tabOrder: reconcileTabOrder([...s.tabOrder, tab.id], [...s.tabs, tab]),
        activeTabId: tab.id,
      }))
      saveStoredTabOrder(get().tabOrder)
      void get().refreshAgentMemory(homeDir)
      void get().refreshAgentMemory(defaultDir)
      return tabId
    } catch {
      const tab = makeLocalTab()
      tab.workingDirectory = homeDir
      set((s) => ({
        tabs: orderTabsByTabOrder([...s.tabs, tab], [...s.tabOrder, tab.id]),
        tabOrder: reconcileTabOrder([...s.tabOrder, tab.id], [...s.tabs, tab]),
        activeTabId: tab.id,
      }))
      saveStoredTabOrder(get().tabOrder)
      void get().refreshAgentMemory(homeDir)
      return tab.id
    }
  },

  forkTabCreated: (newTabId, sourceTabId, parentTitle, workingDirectory, parentSessionId) => {
    // Count existing forks of this parent to generate a unique fork number
    const existingForks = get().tabs.filter((t) => t.parentSessionId === parentSessionId).length
    const forkNumber = existingForks + 1
    const tab: TabState = {
      ...makeLocalTab(),
      id: newTabId,
      title: `${parentTitle} > Fork ${forkNumber}`,
      workingDirectory,
      hasChosenDirectory: true,
      parentSessionId,
    }
    set((s) => ({
      tabs: orderTabsByTabOrder([...s.tabs, tab], [...s.tabOrder, tab.id]),
      tabOrder: reconcileTabOrder([...s.tabOrder, tab.id], [...s.tabs, tab]),
      activeTabId: tab.id,
    }))
    saveStoredTabOrder(get().tabOrder)
  },

  prTabCreated: (newTabId, prNumber, workingDirectory) => {
    const tab: TabState = {
      ...makeLocalTab(),
      id: newTabId,
      title: `PR #${prNumber}`,
      workingDirectory,
      hasChosenDirectory: true,
      prNumber,
    }
    set((s) => ({
      tabs: orderTabsByTabOrder([...s.tabs, tab], [...s.tabOrder, tab.id]),
      tabOrder: reconcileTabOrder([...s.tabOrder, tab.id], [...s.tabs, tab]),
      activeTabId: tab.id,
    }))
    saveStoredTabOrder(get().tabOrder)
  },

  agentTabCreated: (newTabId, parentTabId, agentName, workingDirectory) => {
    const tab: TabState = {
      ...makeLocalTab(),
      id: newTabId,
      title: `Agent: ${agentName}`,
      workingDirectory,
      hasChosenDirectory: true,
      agentName,
      parentTabId,
    }
    // Find parent tab's group and assign agent tab to same group
    const parentTab = get().tabs.find((t) => t.id === parentTabId)
    if (parentTab?.groupId) {
      tab.groupId = parentTab.groupId
    }
    set((s) => ({
      tabs: orderTabsByTabOrder([...s.tabs, tab], [...s.tabOrder, tab.id]),
      tabOrder: reconcileTabOrder([...s.tabOrder, tab.id], [...s.tabs, tab]),
      activeTabId: tab.id,
    }))
    saveStoredTabOrder(get().tabOrder)
  },

  reorderTabs: (newOrder) => {
    set((s) => {
      const nextOrder = reconcileTabOrder(newOrder, s.tabs)
      return {
        tabs: orderTabsByTabOrder(s.tabs, nextOrder),
        tabOrder: nextOrder,
      }
    })
    saveStoredTabOrder(get().tabOrder)
  },

  moveActiveTab: (direction) => {
    const { activeTabId, tabOrder, reorderTabs } = get()
    reorderTabs(moveTabOrderItem(tabOrder, activeTabId, direction))
  },

  selectTab: (tabId) => {
    const s = get()
    useMarketplaceStore.getState().closeMarketplace()
    if (tabId === s.activeTabId) {
      // Clicking the already-active tab: toggle global expand/collapse
      const willExpand = !s.isExpanded
      set((prev) => ({
        isExpanded: willExpand,
        marketplaceOpen: false,
        costDashboardOpen: false,
        // Expanding = reading: clear unread flag
        tabs: willExpand
          ? prev.tabs.map((t) => t.id === tabId ? { ...t, hasUnread: false } : t)
          : prev.tabs,
      }))
      void get().refreshAgentMemory(getResolvedProjectPath(get().tabs.find((t) => t.id === tabId), get().staticInfo))
    } else {
      // Switching to a different tab: mark as read
      set((prev) => ({
        activeTabId: tabId,
        marketplaceOpen: false,
        costDashboardOpen: false,
        tabs: prev.tabs.map((t) =>
          t.id === tabId ? { ...t, hasUnread: false } : t
        ),
      }))
      void get().refreshAgentMemory(getResolvedProjectPath(get().tabs.find((t) => t.id === tabId), get().staticInfo))
    }
  },

  toggleExpanded: () => {
    const { activeTabId, isExpanded } = get()
    const willExpand = !isExpanded
    useMarketplaceStore.getState().closeMarketplace()
    set((s) => ({
      isExpanded: willExpand,
      marketplaceOpen: false,
      costDashboardOpen: false,
      // Expanding = reading: clear unread flag for the active tab
      tabs: willExpand
        ? s.tabs.map((t) => t.id === activeTabId ? { ...t, hasUnread: false } : t)
        : s.tabs,
    }))
  },

  toggleMarketplace: () => {
    const marketplace = useMarketplaceStore.getState()
    if (marketplace.open) {
      marketplace.closeMarketplace()
      set({ marketplaceOpen: false })
    } else {
      marketplace.openMarketplace()
      set({ isExpanded: false, marketplaceOpen: true, costDashboardOpen: false })
      get().loadMarketplace()
    }
  },

  closeMarketplace: () => {
    useMarketplaceStore.getState().closeMarketplace()
    set({ marketplaceOpen: false })
  },

  toggleCostDashboard: () => {
    const s = get()
    if (s.costDashboardOpen) {
      set({ costDashboardOpen: false })
    } else {
      useMarketplaceStore.getState().closeMarketplace()
      set({ isExpanded: false, costDashboardOpen: true, marketplaceOpen: false })
    }
  },

  closeCostDashboard: () => {
    set({ costDashboardOpen: false })
  },

  loadMarketplace: async (forceRefresh) => {
    await useMarketplaceStore.getState().loadMarketplace(forceRefresh)
  },

  setMarketplaceSearch: (query) => {
    useMarketplaceStore.getState().setMarketplaceSearch(query)
    set({ marketplaceSearch: query })
  },

  setMarketplaceFilter: (filter) => {
    useMarketplaceStore.getState().setMarketplaceFilter(filter)
    set({ marketplaceFilter: filter })
  },

  installMarketplacePlugin: async (plugin) => {
    await useMarketplaceStore.getState().installMarketplacePlugin(plugin)
  },

  uninstallMarketplacePlugin: async (plugin) => {
    await useMarketplaceStore.getState().uninstallMarketplacePlugin(plugin)
  },

  buildYourOwn: () => {
    useMarketplaceStore.getState().closeMarketplace()
    set({ marketplaceOpen: false, costDashboardOpen: false, isExpanded: true })
    // Small delay to let the UI transition
    setTimeout(() => {
      get().sendMessage('Help me create a new Claude Code skill')
    }, 100)
  },

  closeTab: (tabId) => {
    clearRetryTimer(tabId)
    useTokenBudgetStore.getState().resetTab(tabId)
    get().clearComposeDraft(tabId)
    deleteChatSession(tabId).catch(() => {}) // Remove persisted session
    window.clui.closeTab(tabId).catch(() => {})

    const s = get()
    const remaining = s.tabs.filter((t) => t.id !== tabId)
    const remainingOrder = s.tabOrder.filter((id) => id !== tabId)

    if (s.activeTabId === tabId) {
      if (remaining.length === 0) {
        const newTab = makeLocalTab()
        const nextOrder = reconcileTabOrder([newTab.id], [newTab])
        set({
          tabs: orderTabsByTabOrder([newTab], nextOrder),
          tabOrder: nextOrder,
          activeTabId: newTab.id,
        })
        saveStoredTabOrder(get().tabOrder)
        // BUG-010: Register the fallback tab with the main process ControlPlane
        // so it has a real backend entry (prevents orphaned renderer-only tab).
        window.clui.createTab().then(({ tabId: realId }) => {
          if (realId !== newTab.id) {
            set((prev) => {
              const nextTabs = prev.tabs.map((t) => (t.id === newTab.id ? { ...t, id: realId } : t))
              const updatedOrder = reconcileTabOrder(
                replaceTabOrderId(prev.tabOrder, newTab.id, realId),
                nextTabs,
              )
              return {
                tabs: orderTabsByTabOrder(nextTabs, updatedOrder),
                tabOrder: updatedOrder,
                activeTabId: realId,
              }
            })
            saveStoredTabOrder(get().tabOrder)
          }
        }).catch((err) => {
          console.warn('[sessionStore] Failed to register fallback tab:', err)
        })
        void get().refreshAgentMemory(getResolvedProjectPath(newTab, get().staticInfo))
        return
      }
      const closedIndex = s.tabs.findIndex((t) => t.id === tabId)
      const newActive = remaining[Math.min(closedIndex, remaining.length - 1)]
      const nextOrder = reconcileTabOrder(remainingOrder, remaining)
      set({
        tabs: orderTabsByTabOrder(remaining, nextOrder),
        tabOrder: nextOrder,
        activeTabId: newActive.id,
      })
      saveStoredTabOrder(get().tabOrder)
      void get().refreshAgentMemory(getResolvedProjectPath(newActive, get().staticInfo))
    } else {
      const nextOrder = reconcileTabOrder(remainingOrder, remaining)
      set({
        tabs: orderTabsByTabOrder(remaining, nextOrder),
        tabOrder: nextOrder,
      })
      saveStoredTabOrder(get().tabOrder)
      void get().refreshAgentMemory(getResolvedProjectPath(get().tabs.find((t) => t.id === s.activeTabId), get().staticInfo))
    }
  },

  clearTab: () => {
    const { activeTabId } = get()
    clearRetryTimer(activeTabId)
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, messages: [], lastResult: null, currentActivity: '', permissionQueue: [], permissionDenied: null, retryState: null, lastRunOptions: null, queuedPrompts: [], queuedRunOptions: [], tokenUsage: null, contextNotificationShown: false }
          : t
      ),
    }))
  },

  resumeSession: async (sessionId, title, projectPath) => {
    const defaultDir = projectPath || get().staticInfo?.homePath || '~'
    try {
      const { tabId } = await window.clui.createTab()

      // Load previous conversation messages from the JSONL file
      const history = await window.clui.loadSession(sessionId, defaultDir).catch(() => [])
      const messages: Message[] = history.map((m) => ({
        id: nextMsgId(),
        role: m.role as Message['role'],
        content: m.content,
        toolName: m.toolName,
        toolStatus: m.toolName ? 'completed' as const : undefined,
        timestamp: m.timestamp,
      }))

      const tab: TabState = {
        ...makeLocalTab(),
        id: tabId,
        claudeSessionId: sessionId,
        title: title || 'Resumed Session',
        workingDirectory: defaultDir,
        hasChosenDirectory: !!projectPath,
        messages,
      }
      set((s) => ({
        tabs: orderTabsByTabOrder([...s.tabs, tab], [...s.tabOrder, tab.id]),
        tabOrder: reconcileTabOrder([...s.tabOrder, tab.id], [...s.tabs, tab]),
        activeTabId: tab.id,
        isExpanded: true,
      }))
      saveStoredTabOrder(get().tabOrder)
      // Don't call initSession — the first real prompt will use --resume with the sessionId
      return tabId
    } catch {
      const tab = makeLocalTab()
      tab.claudeSessionId = sessionId
      tab.title = title || 'Resumed Session'
      tab.workingDirectory = defaultDir
      tab.hasChosenDirectory = !!projectPath
      set((s) => ({
        tabs: orderTabsByTabOrder([...s.tabs, tab], [...s.tabOrder, tab.id]),
        tabOrder: reconcileTabOrder([...s.tabOrder, tab.id], [...s.tabs, tab]),
        activeTabId: tab.id,
        isExpanded: true,
      }))
      saveStoredTabOrder(get().tabOrder)
      return tab.id
    } finally {
      void get().refreshAgentMemory(defaultDir)
    }
  },

  addSystemMessage: (content) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              messages: [
                ...t.messages,
                { id: nextMsgId(), role: 'system' as const, content, timestamp: Date.now() },
              ],
            }
          : t
      ),
    }))
  },

  dismissCompanionMessage: (messageId) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, messages: t.messages.filter((m) => m.id !== messageId) }
          : t
      ),
    }))
  },

  // ─── Permission response ───

  respondPermission: (tabId, questionId, optionId) => {
    usePermissionStore.getState().respondPermission(tabId, questionId, optionId)
  },

  // ─── Directory management ───

  addDirectory: (dir) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              additionalDirs: t.additionalDirs.includes(dir)
                ? t.additionalDirs
                : [...t.additionalDirs, dir],
            }
          : t
      ),
    }))
  },

  removeDirectory: (dir) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, additionalDirs: t.additionalDirs.filter((d) => d !== dir) }
          : t
      ),
    }))
  },

  setBaseDirectory: (dir) => {
    const { activeTabId, tabs } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    if (tab && (tab.status === 'running' || tab.status === 'connecting')) {
      useNotificationStore.getState().addToast({
        type: 'warning',
        title: 'Cannot change directory',
        message: 'Stop the current session to change runtime',
      })
      return
    }
    window.clui.resetTabSession(activeTabId)
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              workingDirectory: dir,
              hasChosenDirectory: true,
              claudeSessionId: null,
              additionalDirs: [],
              tokenUsage: null,
              contextNotificationShown: false,
            }
          : t
      ),
    }))
    void window.clui.getAutoAttachConfig(dir).then((state) => {
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== activeTabId) return t

          const manualAttachments = t.attachments.filter((attachment) => !attachment.autoAttached)
          const manualPaths = new Set(manualAttachments.map((attachment) => attachment.path.toLowerCase()))
          const autoAttachments = state.attachments.filter((attachment) => !manualPaths.has(attachment.path.toLowerCase()))

          return {
            ...t,
            attachments: [...manualAttachments, ...autoAttachments],
          }
        }),
      }))

      if (state.warnings.length > 0) {
        useNotificationStore.getState().addToast({
          type: 'warning',
          title: 'Auto-attach skipped files',
          message: state.warnings[0],
        })
      }
    }).catch(() => {})
    void get().refreshAgentMemory(dir)
  },

  // ─── Attachment management ───

  addAttachments: (attachments) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, attachments: [...t.attachments, ...attachments] }
          : t
      ),
    }))
  },

  removeAttachment: (attachmentId) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, attachments: t.attachments.filter((a) => a.id !== attachmentId) }
          : t
      ),
    }))
  },

  clearAttachments: () => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId ? { ...t, attachments: [] } : t
      ),
    }))
  },

  refreshAgentMemory: async (projectPath) => {
    return useAgentMemoryStore.getState().refreshAgentMemory(projectPath)
  },

  setAgentFocus: async (summary) => {
    return useAgentMemoryStore.getState().setAgentFocus(summary)
  },

  claimAgentWork: async (workKey, summary) => {
    return useAgentMemoryStore.getState().claimAgentWork(workKey, summary)
  },

  markAgentDone: async (note) => {
    return useAgentMemoryStore.getState().markAgentDone(note)
  },

  releaseAgentWork: async () => {
    return useAgentMemoryStore.getState().releaseAgentWork()
  },

  stopRetrying: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    clearRetryTimer(tabId)
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || !t.retryState) return t
        return {
          ...t,
          retryState: {
            ...t.retryState,
            isRetrying: false,
            nextRetryAt: null,
            stopped: true,
          },
          currentActivity: '',
        }
      }),
    }))

    if (tab?.activeRequestId && (tab.status === 'connecting' || tab.status === 'running')) {
      void window.clui.stopTab(tabId).catch(() => {})
    }
  },

  renameTab: (tabId, title) => {
    const trimmed = title.trim()
    if (!trimmed) return
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, title: trimmed } : t)),
    }))
  },

  setTabGroup: (tabId, groupId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, groupId } : t)),
    }))
  },

  setComposeDraft: (tabId, draft) => {
    set((s) => ({
      composeDrafts: { ...s.composeDrafts, [tabId]: draft },
    }))
  },

  clearComposeDraft: (tabId) => {
    set((s) => {
      const next = { ...s.composeDrafts }
      delete next[tabId]
      return { composeDrafts: next }
    })
  },

  retryTab: (tabId) => {
    clearRetryTimer(tabId)
    const { tabs } = get()
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab?.lastRunOptions) return

    const maxAttempts = useThemeStore.getState().autoResumeMaxRetries || DEFAULT_AUTO_RESUME_MAX_RETRIES
    const requestId = crypto.randomUUID()

    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              status: 'connecting' as TabStatus,
              activeRequestId: requestId,
              currentActivity: 'Reconnecting...',
              retryState: {
                isRetrying: true,
                attempt: 1,
                maxAttempts,
                nextRetryAt: null,
                lastError: t.retryState?.lastError,
              },
            }
          : t
      ),
    }))

    void window.clui.retry(tabId, requestId, tab.lastRunOptions).catch((err: Error) => {
      get().handleError(tabId, {
        message: err.message,
        stderrTail: [],
        exitCode: null,
        elapsedMs: 0,
        toolCallCount: 0,
      })
    })
  },

  // ─── Send ───

  sendMessage: (prompt, projectPath) => {
    const { activeTabId, tabs, staticInfo } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    // Use explicitly chosen directory, otherwise fall back to user home
    const resolvedPath = projectPath || getResolvedProjectPath(tab, staticInfo)

    // Guard: don't send while connecting (warmup in progress)
    if (tab.status === 'connecting') return

    const isBusy = tab.status === 'running'
    const requestId = crypto.randomUUID()
    const shouldInferFocus = !tab.agentAssignment && prompt.trim().length > 0

    // Build full prompt with attachment context
    let fullPrompt = prompt
    if (tab.attachments.length > 0) {
      const attachmentCtx = tab.attachments
        .map((a) => `[Attached ${a.type}: ${a.path}]`)
        .join('\n')
      fullPrompt = `${attachmentCtx}\n\n${prompt}`
    }

    // Inject fault memory preamble for first message in session
    if (tab.messages.length === 0) {
      const preamble = useFaultMemoryStore.getState().generatePreamble(resolvedPath)
      if (preamble) {
        fullPrompt = `${preamble}\n\n${fullPrompt}`
        useFaultMemoryStore.getState().markFactsUsed(resolvedPath)
      }
    }

    const title = tab.messages.length === 0
      ? (prompt.length > 30 ? prompt.substring(0, 27) + '...' : prompt)
      : tab.title

    const { preferredModel } = get()
    // Smart model routing: auto-select cheapest adequate model when enabled
    const resolvedModel = useModelRouterStore.getState().resolveModel(
      activeTabId,
      prompt,
      preferredModel,
    )
    // Resolve effort level for this tab
    const effortResult = useModelRouterStore.getState().getEffortForTab(activeTabId)
    const runOptions: RunOptions = {
      prompt: fullPrompt,
      projectPath: resolvedPath,
      sessionId: tab.claudeSessionId || undefined,
      model: resolvedModel || undefined,
      addDirs: tab.additionalDirs.length > 0 ? tab.additionalDirs : undefined,
      effort: effortResult.level,
    }

    clearRetryTimer(activeTabId)

    // Optimistic update: clear attachments
    // If busy, add to queuedPrompts (shown at bottom); otherwise add to messages and set connecting
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== activeTabId) return t
        const withEffectiveBase = t.hasChosenDirectory
          ? t
          : {
              ...t,
              // Once the user sends the first message, lock in the effective
              // base directory (home by default) so the footer no longer shows "—".
              hasChosenDirectory: true,
              workingDirectory: resolvedPath,
            }
        if (isBusy) {
          // Enforce queue backpressure — drop if too many queued
          if (withEffectiveBase.queuedPrompts.length >= MAX_QUEUED_PROMPTS) {
            // UX-017: Show toast when queue is full and prompt is dropped
            useNotificationStore.getState().addToast({
              type: 'warning',
              title: 'Queue full',
              message: `Maximum of ${MAX_QUEUED_PROMPTS} queued prompts reached. Message was not queued.`,
              duration: 5000,
            })
            return withEffectiveBase
          }
          return {
            ...withEffectiveBase,
            title,
            attachments: [],
            queuedPrompts: [...withEffectiveBase.queuedPrompts, prompt],
            queuedRunOptions: [...withEffectiveBase.queuedRunOptions, runOptions],
          }
        }
        return {
          ...withEffectiveBase,
          status: 'connecting' as TabStatus,
          activeRequestId: requestId,
          currentActivity: 'Starting...',
          title,
          attachments: [],
          retryState: null,
          lastRunOptions: runOptions,
          lastActivityAt: Date.now(),
          messages: pruneMessages([
            ...withEffectiveBase.messages,
            { id: nextMsgId(), role: 'user' as const, content: prompt, timestamp: Date.now() },
          ]),
        }
      }),
    }))

    // Send to backend — ControlPlane will queue if a run is active
    window.clui.prompt(activeTabId, requestId, runOptions).catch((err: Error) => {
      get().handleError(activeTabId, {
        message: err.message,
        stderrTail: [],
        exitCode: null,
        elapsedMs: 0,
        toolCallCount: 0,
      })
    })

    if (shouldInferFocus) {
      void get().setAgentFocus(inferFocusSummary(prompt))
    }

    // Fault memory: detect corrections in user message
    const detected = detectCorrection(prompt)
    if (detected) {
      useFaultMemoryStore.getState().addFact({
        project: resolvedPath,
        pattern: detected.pattern,
        correction: detected.correction,
        context: prompt,
        category: detected.category,
      })
      const label = detected.pattern && detected.correction
        ? `use ${detected.correction} instead of ${detected.pattern}`
        : detected.correction
          ? detected.correction
          : `avoid ${detected.pattern}`
      useNotificationStore.getState().addToast({
        type: 'info',
        title: `Noted: ${label}`,
        duration: 3000,
      })
    }
  },

  // ─── Event handlers ───

  handleNormalizedEvent: (tabId, event) => {
    set((s) => {
      const { activeTabId } = s

      // ── Optimization 2: targeted single-tab update ──
      // Find the affected tab index once. If the tab doesn't exist, bail out
      // early returning the same state reference so React selectors skip re-renders.
      const tabIndex = s.tabs.findIndex((t) => t.id === tabId)
      if (tabIndex === -1) return s

      const tab = s.tabs[tabIndex]
      const updated = { ...tab }

      switch (event.type) {
        case 'session_init':
          updated.claudeSessionId = event.sessionId
          updated.sessionModel = event.model
          updated.sessionTools = event.tools
          updated.sessionMcpServers = event.mcpServers
          updated.sessionSkills = event.skills
          updated.sessionVersion = event.version
          // Don't change status/activity for warmup inits — they're invisible
          if (!event.isWarmup) {
            updated.status = 'running'
            updated.currentActivity = 'Thinking...'
            // Move the first queued prompt into the timeline (it's now being processed)
            if (updated.queuedPrompts.length > 0) {
              const [nextPrompt, ...rest] = updated.queuedPrompts
              const [nextRunOptions, ...restRunOptions] = updated.queuedRunOptions
              updated.queuedPrompts = rest
              updated.queuedRunOptions = restRunOptions
              if (nextRunOptions) {
                updated.lastRunOptions = nextRunOptions
              }
              updated.messages = pruneMessages([
                ...updated.messages,
                { id: nextMsgId(), role: 'user' as const, content: nextPrompt, timestamp: Date.now() },
              ])
            }
          }
          break

        case 'text_chunk': {
          const lastMsg = updated.messages[updated.messages.length - 1]
          // Throttle content-type detection: run every 5 chunks
          const prevChunkCount = lastMsg?.role === 'assistant' && lastMsg._textChunks ? lastMsg._textChunks.length : 0
          if (prevChunkCount % 5 === 0) {
            const allText = lastMsg?.role === 'assistant' && lastMsg._textChunks
              ? lastMsg._textChunks.join('') + event.text
              : event.text
            updated.currentActivity = detectContentType(allText)
          }
          if (lastMsg?.role === 'assistant' && !lastMsg.toolName) {
            // ── Optimization 1: buffer chunks to avoid O(n²) string concatenation ──
            // Chunks are joined by getMessageContent() during rendering and flushed
            // into `content` on task_complete / error / session_dead.
            const msgs = updated.messages.slice()
            let chunks: string[]
            if (lastMsg._textChunks) {
              chunks = [...lastMsg._textChunks, event.text]
            } else if (lastMsg.content) {
              // Existing message with plain content (e.g. from history) — migrate it
              chunks = [lastMsg.content, event.text]
            } else {
              chunks = [event.text]
            }
            msgs[msgs.length - 1] = { ...lastMsg, content: '', _textChunks: chunks }
            updated.messages = msgs
          } else {
            updated.messages = pruneMessages([
              ...updated.messages,
              { id: nextMsgId(), role: 'assistant', content: '', _textChunks: [event.text], timestamp: Date.now() },
            ])
          }
          break
        }

        case 'tool_call':
          updated.currentActivity = `Running ${event.toolName}...`
          updated.messages = pruneMessages([
            ...updated.messages,
            {
              id: nextMsgId(),
              role: 'tool',
              content: '',
              toolName: event.toolName,
              toolInput: '',
              toolStatus: 'running',
              timestamp: Date.now(),
            },
          ])
          break

        case 'tool_call_update': {
          const msgs = [...updated.messages]
          const lastToolIdx = findLastIndex(msgs, (m) => m.role === 'tool' && m.toolStatus === 'running')
          if (lastToolIdx >= 0) {
            const lastTool = msgs[lastToolIdx]
            msgs[lastToolIdx] = { ...lastTool, toolInput: (lastTool.toolInput || '') + event.partialInput }
          }
          updated.messages = msgs
          break
        }

        case 'tool_call_complete': {
          const msgs2 = [...updated.messages]
          const runningToolIdx = findLastIndex(msgs2, (m) => m.role === 'tool' && m.toolStatus === 'running')
          if (runningToolIdx >= 0) {
            msgs2[runningToolIdx] = { ...msgs2[runningToolIdx], toolStatus: 'completed' }
          }
          updated.messages = msgs2
          break
        }

        case 'task_update':
          if (event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'tool_use' && block.name) {
                const exists = updated.messages.find(
                  (m) => m.role === 'tool' && m.toolName === block.name && !m.content
                )
                if (!exists) {
                  updated.messages = pruneMessages([
                    ...updated.messages,
                    {
                      id: nextMsgId(),
                      role: 'tool',
                      content: '',
                      toolName: block.name,
                      toolInput: JSON.stringify(block.input, null, 2),
                      toolStatus: 'completed',
                      timestamp: Date.now(),
                    },
                  ])
                }
              }
            }
          }
          break

        case 'task_complete':
          updated.status = 'completed'
          updated.activeRequestId = null
          updated.currentActivity = ''
          updated.permissionQueue = []
          updated.retryState = null
          // Flush buffered text chunks into content so messages are clean for export
          updated.messages = flushTextChunks(updated.messages)
          updated.lastResult = {
            totalCostUsd: event.costUsd,
            durationMs: event.durationMs,
            numTurns: event.numTurns,
            usage: event.usage,
            sessionId: event.sessionId,
          }
          // Mark as unread unless the user is actively viewing this tab
          // (active tab with card expanded). A collapsed active tab still
          // counts as "unread" — the user hasn't seen the response yet.
          if (tabId !== activeTabId || !s.isExpanded) {
            updated.hasUnread = true
          }
          // Show fallback card when tools were denied by permission settings
          if (event.permissionDenials && event.permissionDenials.length > 0) {
            updated.permissionDenied = { tools: event.permissionDenials }
          } else {
            updated.permissionDenied = null
          }
          // Record cost to persistent history
          try {
            window.clui.recordCost({
              timestamp: Date.now(),
              sessionId: event.sessionId,
              model: updated.sessionModel,
              projectPath: updated.workingDirectory,
              costUsd: event.costUsd,
              durationMs: event.durationMs,
              numTurns: event.numTurns,
              inputTokens: event.usage.input_tokens ?? 0,
              outputTokens: event.usage.output_tokens ?? 0,
              cacheReadTokens: event.usage.cache_read_input_tokens ?? 0,
              cacheCreationTokens: event.usage.cache_creation_input_tokens ?? 0,
            })
          } catch {
            // Cost recording failure is non-fatal
          }
          // Token budget tracking now happens via token_usage events (more granular than task_complete)
          // Record cost for budget tracking
          try {
            useBudgetStore.getState().recordTabCost(tabId, event.costUsd)
          } catch {
            // Budget tracking failure is non-fatal
          }
          // Play notification sound if window is hidden
          playNotificationIfHidden()
          // Desktop notification when window is not focused
          if (useNotificationStore.getState().desktopEnabled) {
            window.clui.sendDesktopNotification(
              'Task Complete',
              `Finished in ${Math.round(event.durationMs / 1000)}s ($${event.costUsd.toFixed(4)})`,
            ).catch(() => {})
          }
          break

        case 'error':
          updated.status = 'failed'
          updated.activeRequestId = null
          updated.currentActivity = ''
          updated.permissionQueue = []
          updated.permissionDenied = null
          updated.messages = [
            ...flushTextChunks(updated.messages),
            { id: nextMsgId(), role: 'system', content: `Error: ${event.message}`, timestamp: Date.now() },
          ]
          break

        case 'session_dead':
          updated.status = 'dead'
          updated.activeRequestId = null
          updated.currentActivity = ''
          updated.permissionQueue = []
          updated.permissionDenied = null
          updated.retryState = updated.retryState
            ? {
                ...updated.retryState,
                isRetrying: false,
                nextRetryAt: null,
                lastError: `Session ended unexpectedly (exit ${event.exitCode})`,
              }
            : null
          updated.messages = [
            ...flushTextChunks(updated.messages),
            {
              id: nextMsgId(),
              role: 'system',
              content: `Session ended unexpectedly (exit ${event.exitCode})`,
              timestamp: Date.now(),
            },
          ]
          useNotificationStore.getState().addToast({
            type: 'error',
            title: 'Process crashed',
            message: `Session ended unexpectedly (exit ${event.exitCode})`,
          })
          break

        case 'permission_request': {
          const newReq: import('../../shared/types').PermissionRequest = {
            questionId: event.questionId,
            toolTitle: event.toolName,
            toolDescription: event.toolDescription,
            toolInput: event.toolInput,
            options: event.options.map((o) => ({
              optionId: o.id,
              kind: o.kind,
              label: o.label,
            })),
          }

          // Auto-approve if tool is trusted or batch approve is active
          const permStore = usePermissionStore.getState()
          const shouldAutoApprove = permStore.isToolTrusted(event.toolName) || permStore.isBatchApproveActive()
          if (shouldAutoApprove) {
            const allowOpt = newReq.options.find(
              (o) => o.kind === 'allow' || o.label.toLowerCase().includes('allow') || o.label.toLowerCase().includes('yes')
            )
            if (allowOpt) {
              // Schedule auto-respond outside of setState to avoid re-entrancy
              queueMicrotask(() => {
                permStore.respondPermission(tabId, newReq.questionId, allowOpt.optionId)
              })
              break
            }
          }

          updated.permissionQueue = [...updated.permissionQueue, newReq]
          updated.currentActivity = `Waiting for permission: ${event.toolName}`
          break
        }

        case 'rate_limit':
          if (event.status !== 'allowed') {
            updated.messages = [
              ...updated.messages,
              {
                id: nextMsgId(),
                role: 'system',
                content: `Rate limited (${event.rateLimitType}). Resets at ${new Date(event.resetsAt).toLocaleTimeString()}.`,
                timestamp: Date.now(),
              },
            ]
          }
          break

        case 'token_usage': {
          const prev = updated.tokenUsage
          const newUsage = {
            inputTokens: (prev?.inputTokens ?? 0) + event.inputTokens,
            outputTokens: (prev?.outputTokens ?? 0) + event.outputTokens,
            totalTokens: (prev?.totalTokens ?? 0) + event.totalTokens,
            cacheReadTokens: (prev?.cacheReadTokens ?? 0) + (event.cacheReadTokens ?? 0),
            cacheWriteTokens: (prev?.cacheWriteTokens ?? 0) + (event.cacheWriteTokens ?? 0),
            lastUpdated: Date.now(),
          }
          updated.tokenUsage = newUsage
          break
        }

        case 'context_management': {
          // Show a system message indicating CLI auto-compaction
          updated.messages = pruneMessages([
            ...updated.messages,
            {
              id: nextMsgId(),
              role: 'system',
              content: 'Context auto-compacted by CLI',
              timestamp: Date.now(),
            },
          ])
          break
        }

        case 'companion_message': {
          updated.messages = [
            ...updated.messages,
            { id: nextMsgId(), role: 'system' as const, content: event.content, timestamp: Date.now(), isCompanion: true },
          ]
          break
        }

        // Sandbox events — dispatched to sandboxStore after set() completes
        case 'sandbox_worktree_created':
        case 'sandbox_diff_ready':
        case 'sandbox_merge_done':
        case 'sandbox_dirty_warning':
          break
      }

      // Update lastActivityAt for events that indicate real session activity
      if (
        event.type === 'text_chunk' ||
        event.type === 'tool_call' ||
        event.type === 'tool_call_complete' ||
        event.type === 'task_complete' ||
        event.type === 'session_init' ||
        event.type === 'task_update'
      ) {
        updated.lastActivityAt = Date.now()
      }

      // ── Optimization 2: splice only the changed tab, preserve all other references ──
      const nextTabs = s.tabs.slice()
      nextTabs[tabIndex] = updated
      return { tabs: nextTabs }
    })

    // ── Persist session to IndexedDB on meaningful changes (#313) ──
    if (
      event.type === 'text_chunk' ||
      event.type === 'tool_call' ||
      event.type === 'tool_call_complete' ||
      event.type === 'task_complete' ||
      event.type === 'session_dead' ||
      event.type === 'error'
    ) {
      debouncedSave(tabId)
    }

    // ── Token budget sync (outside set() — mutates tokenBudgetStore, not sessionStore) ──
    if (event.type === 'token_usage') {
      try {
        useTokenBudgetStore.getState().recordUsage(tabId, {
          input_tokens: event.inputTokens,
          output_tokens: event.outputTokens,
          cache_read_input_tokens: event.cacheReadTokens,
          cache_creation_input_tokens: event.cacheWriteTokens,
        })
      } catch {
        // Token budget tracking failure is non-fatal
      }
    }

    // ── Sandbox event dispatch (outside set() — these mutate sandboxStore, not sessionStore) ──
    switch (event.type) {
      case 'sandbox_worktree_created':
        useSandboxStore.getState().setWorktree(tabId, event.worktreeInfo)
        break
      case 'sandbox_diff_ready':
        useSandboxStore.getState().setDiff(tabId, event.diff)
        break
      case 'sandbox_merge_done':
        useSandboxStore.getState().setMergeStatus(tabId, event.result.ok ? 'merged' : 'conflict')
        break
      case 'sandbox_dirty_warning':
        useSandboxStore.getState().setPendingDirtyWarning({ tabId, runId: event.runId, dirty: event.dirty })
        break
    }

    // ── Proactive context size notification ──
    if (event.type === 'token_usage') {
      const tab = get().tabs.find((t) => t.id === tabId)
      if (tab && tab.tokenUsage && !tab.contextNotificationShown) {
        const totalTokens = tab.tokenUsage.totalTokens
        // Threshold: notify when context exceeds 100k tokens
        // or when context-pruner estimates > 20% savings or > 8k collapsible tokens
        let shouldNotify = totalTokens > 100_000
        if (!shouldNotify && tab.messages.length > 10) {
          try {
            const pruneResult = analyzeForPruning(tab.messages)
            const savingsRatio = totalTokens > 0 ? pruneResult.savedTokens / totalTokens : 0
            shouldNotify = savingsRatio > 0.2 || pruneResult.savedTokens > 8_000
          } catch {
            // context-pruner analysis failure is non-fatal
          }
        }

        if (shouldNotify) {
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.id === tabId ? { ...t, contextNotificationShown: true } : t
            ),
          }))
          const formatted = totalTokens >= 1_000
            ? `~${Math.round(totalTokens / 1_000)}k`
            : String(totalTokens)
          useNotificationStore.getState().addToast({
            type: 'warning',
            title: 'Large context',
            message: `Context is getting large (${formatted} tokens). Consider starting a new session.`,
            duration: 8000,
          })
        }
      }
    }

    if (event.type !== 'session_dead') return

    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return

    const { autoResumeEnabled, autoResumeMaxRetries } = useThemeStore.getState()
    const maxAttempts = autoResumeMaxRetries || DEFAULT_AUTO_RESUME_MAX_RETRIES
    const currentAttempt = tab.retryState?.attempt ?? 0

    const shouldRetry = canScheduleAutoResume({
      enabled: autoResumeEnabled,
      currentAttempt,
      maxAttempts,
      hasRunOptions: !!tab.lastRunOptions,
      isAlreadyRetrying: tab.retryState?.isRetrying ?? false,
    })

    if (!shouldRetry) {
      if (autoResumeEnabled && tab.lastRunOptions && currentAttempt >= maxAttempts) {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  retryState: {
                    isRetrying: false,
                    attempt: currentAttempt,
                    maxAttempts,
                    nextRetryAt: null,
                    lastError: `Session ended unexpectedly (exit ${event.exitCode})`,
                    exhausted: true,
                  },
                  currentActivity: '',
                }
              : t
          ),
        }))
      }
      return
    }

    const attempt = currentAttempt + 1
    const delay = getAutoResumeDelayMs(attempt)
    const nextRetryAt = delay > 0 ? Date.now() + delay : null

    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              retryState: {
                isRetrying: true,
                attempt,
                maxAttempts,
                nextRetryAt,
                lastError: `Session ended unexpectedly (exit ${event.exitCode})`,
              },
              currentActivity: delay === 0 ? 'Reconnecting...' : t.currentActivity,
            }
          : t
      ),
    }))

    clearRetryTimer(tabId)

    const triggerRetry = () => {
      retryTimers.delete(tabId)
      const currentTab = get().tabs.find((t) => t.id === tabId)
      if (!currentTab?.lastRunOptions) return
      if (currentTab.retryState?.stopped || currentTab.retryState?.exhausted) return

      const requestId = crypto.randomUUID()

      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                status: 'connecting' as TabStatus,
                activeRequestId: requestId,
                currentActivity: 'Reconnecting...',
                retryState: t.retryState
                  ? {
                      ...t.retryState,
                      isRetrying: true,
                      nextRetryAt: null,
                    }
                  : null,
              }
            : t
        ),
      }))

      void window.clui.retry(tabId, requestId, currentTab.lastRunOptions).catch((err: Error) => {
        get().handleError(tabId, {
          message: err.message,
          stderrTail: [],
          exitCode: null,
          elapsedMs: 0,
          toolCallCount: 0,
        })
      })
    }

    if (delay === 0) {
      setTimeout(triggerRetry, 0)
    } else {
      retryTimers.set(tabId, setTimeout(triggerRetry, delay))
    }
  },

  handleStatusChange: (tabId, newStatus) => {
    if (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'idle') {
      clearRetryTimer(tabId)
    }

    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              status: newStatus as TabStatus,
              // Clear activity when transitioning to idle (e.g., after warmup init)
              ...(newStatus === 'idle' ? { currentActivity: '', permissionQueue: [] as import('../../shared/types').PermissionRequest[], permissionDenied: null } : {}),
              ...((newStatus === 'completed' || newStatus === 'failed')
                ? { retryState: null }
                : {}),
            }
          : t
      ),
    }))
    debouncedSave(tabId)
  },

  handleError: (tabId, error) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t

        // Deduplicate: skip if the last message is already an error for this failure
        const lastMsg = t.messages[t.messages.length - 1]
        const alreadyHasError = lastMsg?.role === 'system' && lastMsg.content.startsWith('Error:')

        return {
          ...t,
          status: 'failed' as TabStatus,
          activeRequestId: null,
          currentActivity: '',
          permissionQueue: [],
          retryState: t.retryState,
          messages: alreadyHasError
            ? t.messages
            : [
                ...t.messages,
                {
                  id: nextMsgId(),
                  role: 'system' as const,
                  content: `Error: ${error.message}${error.stderrTail.length > 0 ? '\n\n' + error.stderrTail.slice(-5).join('\n') : ''}`,
                  timestamp: Date.now(),
                },
              ],
        }
      }),
    }))
    useNotificationStore.getState().addToast({
      type: 'error',
      title: 'Error',
      message: error.message,
    })
  },
}))

// ─── Restore persisted sessions from IndexedDB on startup (#313) ───

void (async () => {
  try {
    const persisted = await loadChatSessions()
    void purgeOldSessions()
    if (persisted.length === 0) return

    const restoredTabs: TabState[] = persisted.map((session) => ({
      ...makeLocalTab(),
      id: session.tabId,
      claudeSessionId: session.claudeSessionId,
      status: 'dead' as TabStatus,
      title: session.title || 'Restored Session',
      workingDirectory: session.workingDirectory || '~',
      hasChosenDirectory: !!session.workingDirectory,
      isRestored: true,
      messages: session.messages.map((m) => ({
        id: m.id,
        role: m.role as Message['role'],
        content: m.content,
        timestamp: m.timestamp,
      })),
    }))

    useSessionStore.setState((s) => {
      const newTabs = [...restoredTabs, ...s.tabs]
      const newOrder = reconcileTabOrder(
        [...restoredTabs.map((t) => t.id), ...s.tabOrder],
        newTabs,
      )
      return {
        tabs: orderTabsByTabOrder(newTabs, newOrder),
        tabOrder: newOrder,
      }
    })
    saveStoredTabOrder(useSessionStore.getState().tabOrder)
  } catch (err) {
    console.warn('[sessionStore] Failed to restore persisted sessions:', err)
  }
})()
