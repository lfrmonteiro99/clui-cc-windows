import { create } from 'zustand'
import { useSessionStore } from './sessionStore'
import { hasSlots as templateHasSlots } from '../../shared/template-engine'
import { createEvictionManager } from './store-eviction'

export interface Snippet {
  id: string
  name: string
  command: string
  content: string
  createdAt: number
  updatedAt: number
  /** True when content contains [SLOT] placeholders */
  hasSlots: boolean
}

interface SnippetState {
  snippets: Snippet[]
  managerOpen: boolean
  addSnippet: (name: string, command: string, content: string) => Snippet | null
  updateSnippet: (id: string, updates: Partial<Pick<Snippet, 'name' | 'command' | 'content'>>) => boolean
  deleteSnippet: (id: string) => void
  openManager: () => void
  closeManager: () => void
}

const STORAGE_KEY = 'clui-snippets'
const BUILT_IN_COMMANDS = new Set([
  '/clear',
  '/focus',
  '/claim',
  '/done',
  '/release',
  '/memory',
  '/export',
  '/cost',
  '/model',
  '/mcp',
  '/skills',
  '/workflow',
  '/help',
])

function loadSnippets(): Snippet[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const rawSnippet = entry as Partial<Snippet>
      if (typeof rawSnippet.id !== 'string' || typeof rawSnippet.name !== 'string' || typeof rawSnippet.command !== 'string' || typeof rawSnippet.content !== 'string') {
        return []
      }
      const content = rawSnippet.content
      return [{
        id: rawSnippet.id,
        name: rawSnippet.name.trim(),
        command: normalizeCommand(rawSnippet.command),
        content,
        createdAt: typeof rawSnippet.createdAt === 'number' ? rawSnippet.createdAt : Date.now(),
        updatedAt: typeof rawSnippet.updatedAt === 'number' ? rawSnippet.updatedAt : Date.now(),
        hasSlots: templateHasSlots(content),
      }]
    })
  } catch (err) {
    console.warn('[snippetStore] loadSnippets failed:', err)
    return []
  }
}

function saveSnippets(snippets: Snippet[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets))
  } catch (err) {
    console.warn('[snippetStore] saveSnippets failed:', err)
  }
}

function normalizeCommand(command: string): string {
  const trimmed = command.trim()
  if (!trimmed) return '/'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function isValidCommand(command: string): boolean {
  return /^\/[a-zA-Z0-9-]+$/.test(command)
}

function collides(command: string, snippets: Snippet[], currentId?: string): boolean {
  if (BUILT_IN_COMMANDS.has(command)) {
    return true
  }
  const skillCommands = new Set(
    useSessionStore.getState().tabs.flatMap((tab) =>
      (tab.sessionSkills || []).map((skill) => `/${skill}`.toLowerCase()),
    ),
  )
  if (skillCommands.has(command.toLowerCase())) {
    return true
  }
  return snippets.some((snippet) => snippet.command === command && snippet.id !== currentId)
}

const DEFAULT_TEMPLATE_SNIPPETS: Array<{ name: string; command: string; content: string }> = [
  { name: 'Fix file', command: '/fix', content: 'Fix the issue in [FILE]: [DESCRIPTION]' },
  { name: 'Refactor file', command: '/refactor', content: 'Refactor [FILE] to [GOAL]' },
  { name: 'Write tests', command: '/test', content: 'Write tests for [FILE]' },
  { name: 'Explain file', command: '/explain', content: 'Explain how [FILE] works' },
  { name: 'Review file', command: '/review', content: 'Review [FILE] for issues' },
]

const DEFAULTS_SEEDED_KEY = 'clui-snippets-defaults-seeded'

function seedDefaultSnippets(existing: Snippet[]): Snippet[] {
  try {
    if (typeof localStorage === 'undefined') return existing
    if (localStorage.getItem(DEFAULTS_SEEDED_KEY)) return existing
    localStorage.setItem(DEFAULTS_SEEDED_KEY, '1')
  } catch {
    return existing
  }

  const existingCommands = new Set(existing.map((s) => s.command))
  const now = Date.now()
  const defaults: Snippet[] = DEFAULT_TEMPLATE_SNIPPETS
    .filter((d) => !existingCommands.has(d.command) && !BUILT_IN_COMMANDS.has(d.command))
    .map((d, i) => ({
      id: crypto.randomUUID(),
      name: d.name,
      command: d.command,
      content: d.content,
      createdAt: now - i,
      updatedAt: now - i,
      hasSlots: templateHasSlots(d.content),
    }))

  if (defaults.length === 0) return existing
  const merged = [...existing, ...defaults]
  saveSnippets(merged)
  return merged
}

// ─── Eviction manager ───
// Caps snippets at 500 entries (LRU). No TTL — snippets are user-created
// named items that should only age out when the collection grows very large.

const snippetEviction = createEvictionManager<string>(
  { maxEntries: 500, evictionInterval: 60_000 },
)

const initialSnippets = seedDefaultSnippets(loadSnippets())

// Seed the tracker from persisted snippets so LRU order is accurate from startup
initialSnippets.forEach((s) => snippetEviction.touch(s.id))

export const useSnippetStore = create<SnippetState>((set, get) => {
  // Start periodic pruning
  snippetEviction.startInterval(() => get().snippets.map((s) => s.id))

  return {
    snippets: initialSnippets,
    managerOpen: false,

    addSnippet: (name, command, content) => {
      const nextCommand = normalizeCommand(command)
      const nextName = name.trim()
      const nextContent = content.trim()
      if (!nextName || !nextContent || !isValidCommand(nextCommand) || collides(nextCommand, get().snippets)) {
        return null
      }

      const snippet: Snippet = {
        id: crypto.randomUUID(),
        name: nextName,
        command: nextCommand,
        content: nextContent,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        hasSlots: templateHasSlots(nextContent),
      }

      snippetEviction.touch(snippet.id)
      const snippets = [...get().snippets, snippet].sort((a, b) => b.updatedAt - a.updatedAt)
      saveSnippets(snippets)
      set({ snippets })
      return snippet
    },

    updateSnippet: (id, updates) => {
      const current = get().snippets.find((snippet) => snippet.id === id)
      if (!current) return false

      const nextName = (updates.name ?? current.name).trim()
      const nextCommand = normalizeCommand(updates.command ?? current.command)
      const nextContent = (updates.content ?? current.content).trim()

      if (!nextName || !nextContent || !isValidCommand(nextCommand) || collides(nextCommand, get().snippets, id)) {
        return false
      }

      snippetEviction.touch(id)
      const snippets = get().snippets
        .map((snippet) => snippet.id === id ? {
          ...snippet,
          name: nextName,
          command: nextCommand,
          content: nextContent,
          updatedAt: Date.now(),
          hasSlots: templateHasSlots(nextContent),
        } : snippet)
        .sort((a, b) => b.updatedAt - a.updatedAt)

      saveSnippets(snippets)
      set({ snippets })
      return true
    },

    deleteSnippet: (id) => {
      snippetEviction.delete(id)
      const snippets = get().snippets.filter((snippet) => snippet.id !== id)
      saveSnippets(snippets)
      set({ snippets })
    },

    openManager: () => set({ managerOpen: true }),
    closeManager: () => set({ managerOpen: false }),
  }
})
