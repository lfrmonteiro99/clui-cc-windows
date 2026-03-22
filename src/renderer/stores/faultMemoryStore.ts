/**
 * Zustand store for Session Fault Memory — persists user corrections to localStorage
 * scoped by project (working directory).
 *
 * Facts are injected as a compact preamble into future prompts so Claude "remembers"
 * user preferences without being told twice.
 */

import { create } from 'zustand'
import type { ProjectFact, FactCategory } from '../../shared/fault-memory-types'

// ─── Persistence helpers ───

const STORAGE_KEY = 'clui-fault-memory'
const MAX_FACTS_PER_PROJECT = 100

function loadFacts(): ProjectFact[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return []
      const fact = entry as Partial<ProjectFact>
      if (
        typeof fact.id !== 'string' ||
        typeof fact.project !== 'string' ||
        typeof fact.correction !== 'string' ||
        typeof fact.context !== 'string'
      ) {
        return []
      }
      return [{
        id: fact.id,
        project: fact.project,
        pattern: typeof fact.pattern === 'string' ? fact.pattern : '',
        correction: fact.correction,
        context: fact.context,
        category: isValidCategory(fact.category) ? fact.category : 'other',
        createdAt: typeof fact.createdAt === 'number' ? fact.createdAt : Date.now(),
        usageCount: typeof fact.usageCount === 'number' ? fact.usageCount : 0,
        lastUsedAt: typeof fact.lastUsedAt === 'number' ? fact.lastUsedAt : 0,
      }]
    })
  } catch {
    return []
  }
}

function isValidCategory(value: unknown): value is FactCategory {
  return value === 'tooling' || value === 'style' || value === 'convention' || value === 'preference' || value === 'other'
}

function saveFacts(facts: ProjectFact[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(facts))
  } catch { /* quota exceeded — silently degrade */ }
}

// ─── Store ───

interface FaultMemoryState {
  facts: ProjectFact[]
  managerOpen: boolean

  addFact: (fact: Omit<ProjectFact, 'id' | 'createdAt' | 'usageCount' | 'lastUsedAt'>) => ProjectFact
  getFactsForProject: (project: string) => ProjectFact[]
  removeFact: (id: string) => void
  clearProjectFacts: (project: string) => void
  generatePreamble: (project: string) => string
  markFactsUsed: (project: string) => void
  openManager: () => void
  closeManager: () => void
}

const initialFacts = loadFacts()

export const useFaultMemoryStore = create<FaultMemoryState>((set, get) => ({
  facts: initialFacts,
  managerOpen: false,

  addFact: (factInput) => {
    const { facts } = get()

    // Deduplicate: skip if an identical correction+pattern already exists for this project
    const duplicate = facts.find(
      (f) =>
        f.project === factInput.project &&
        f.correction.toLowerCase() === factInput.correction.toLowerCase() &&
        f.pattern.toLowerCase() === factInput.pattern.toLowerCase(),
    )
    if (duplicate) return duplicate

    const newFact: ProjectFact = {
      ...factInput,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      usageCount: 0,
      lastUsedAt: 0,
    }

    let projectFacts = facts.filter((f) => f.project === factInput.project)
    const otherFacts = facts.filter((f) => f.project !== factInput.project)

    projectFacts = [...projectFacts, newFact]

    // Enforce per-project limit — evict oldest first
    if (projectFacts.length > MAX_FACTS_PER_PROJECT) {
      projectFacts = projectFacts
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MAX_FACTS_PER_PROJECT)
    }

    const nextFacts = [...otherFacts, ...projectFacts]
    saveFacts(nextFacts)
    set({ facts: nextFacts })
    return newFact
  },

  getFactsForProject: (project) => {
    return get().facts.filter((f) => f.project === project)
  },

  removeFact: (id) => {
    const facts = get().facts.filter((f) => f.id !== id)
    saveFacts(facts)
    set({ facts })
  },

  clearProjectFacts: (project) => {
    const facts = get().facts.filter((f) => f.project !== project)
    saveFacts(facts)
    set({ facts })
  },

  generatePreamble: (project) => {
    const projectFacts = get().facts.filter((f) => f.project === project)
    if (projectFacts.length === 0) return ''

    const lines = projectFacts.map((f) => {
      if (f.pattern && f.correction) {
        return `- Use ${f.correction}, not ${f.pattern}.`
      }
      if (f.correction) {
        return `- ${f.correction}.`
      }
      if (f.pattern) {
        return `- Avoid ${f.pattern}.`
      }
      return null
    }).filter(Boolean)

    if (lines.length === 0) return ''
    return `Project conventions:\n${lines.join('\n')}`
  },

  markFactsUsed: (project) => {
    const now = Date.now()
    const facts = get().facts.map((f) => {
      if (f.project !== project) return f
      return { ...f, usageCount: f.usageCount + 1, lastUsedAt: now }
    })
    saveFacts(facts)
    set({ facts })
  },

  openManager: () => set({ managerOpen: true }),
  closeManager: () => set({ managerOpen: false }),
}))
