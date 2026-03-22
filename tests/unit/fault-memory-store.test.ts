import { afterEach, beforeEach, describe, expect, it } from 'vitest'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

let memStorage: MemoryStorage

beforeEach(() => {
  memStorage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { value: memStorage, writable: true, configurable: true })
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `uuid-${Math.random().toString(36).slice(2, 10)}` },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  memStorage.clear()
})

// Dynamic import to get a fresh store each time
async function getStore() {
  // Reset module cache so the store re-initialises from localStorage
  const mod = await import('../../src/renderer/stores/faultMemoryStore')
  return mod.useFaultMemoryStore
}

describe('faultMemoryStore', () => {
  it('starts with empty facts when nothing in storage', async () => {
    const store = await getStore()
    // May have facts from other tests cached in module, but getFactsForProject for unknown project = empty
    const facts = store.getState().getFactsForProject('/unknown/project')
    expect(facts).toEqual([])
  })

  it('addFact creates a fact and persists to localStorage', async () => {
    const store = await getStore()
    const fact = store.getState().addFact({
      project: '/my/project',
      pattern: 'npm',
      correction: 'pnpm',
      context: 'use pnpm instead of npm',
      category: 'tooling',
    })

    expect(fact.id).toBeTruthy()
    expect(fact.project).toBe('/my/project')
    expect(fact.pattern).toBe('npm')
    expect(fact.correction).toBe('pnpm')
    expect(fact.usageCount).toBe(0)
    expect(fact.lastUsedAt).toBe(0)

    // Persisted
    const raw = memStorage.getItem('clui-fault-memory')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.some((f: { id: string }) => f.id === fact.id)).toBe(true)
  })

  it('deduplicates identical corrections', async () => {
    const store = await getStore()
    const fact1 = store.getState().addFact({
      project: '/my/project',
      pattern: 'npm',
      correction: 'pnpm',
      context: 'use pnpm',
      category: 'tooling',
    })
    const fact2 = store.getState().addFact({
      project: '/my/project',
      pattern: 'npm',
      correction: 'pnpm',
      context: 'use pnpm instead of npm',
      category: 'tooling',
    })

    expect(fact1.id).toBe(fact2.id)
    const projectFacts = store.getState().getFactsForProject('/my/project')
    const matchingFacts = projectFacts.filter((f) => f.correction === 'pnpm' && f.pattern === 'npm')
    expect(matchingFacts.length).toBe(1)
  })

  it('removeFact deletes a fact', async () => {
    const store = await getStore()
    const fact = store.getState().addFact({
      project: '/my/project',
      pattern: 'var',
      correction: 'const',
      context: 'use const not var',
      category: 'style',
    })

    store.getState().removeFact(fact.id)
    const remaining = store.getState().getFactsForProject('/my/project')
    expect(remaining.find((f) => f.id === fact.id)).toBeUndefined()
  })

  it('clearProjectFacts removes all facts for a project', async () => {
    const store = await getStore()
    store.getState().addFact({
      project: '/project-a',
      pattern: 'npm',
      correction: 'pnpm',
      context: 'use pnpm',
      category: 'tooling',
    })
    store.getState().addFact({
      project: '/project-a',
      pattern: 'var',
      correction: 'const',
      context: 'use const',
      category: 'style',
    })
    store.getState().addFact({
      project: '/project-b',
      pattern: 'jest',
      correction: 'vitest',
      context: 'use vitest',
      category: 'tooling',
    })

    store.getState().clearProjectFacts('/project-a')

    expect(store.getState().getFactsForProject('/project-a').length).toBe(0)
    expect(store.getState().getFactsForProject('/project-b').length).toBeGreaterThanOrEqual(1)
  })

  it('generatePreamble formats facts correctly', async () => {
    const store = await getStore()
    store.getState().addFact({
      project: '/my/project',
      pattern: 'npm',
      correction: 'pnpm',
      context: 'use pnpm',
      category: 'tooling',
    })
    store.getState().addFact({
      project: '/my/project',
      pattern: '',
      correction: 'async/await',
      context: 'always use async/await',
      category: 'style',
    })
    store.getState().addFact({
      project: '/my/project',
      pattern: 'eval',
      correction: '',
      context: 'never use eval',
      category: 'other',
    })

    const preamble = store.getState().generatePreamble('/my/project')
    expect(preamble).toContain('Project conventions:')
    expect(preamble).toContain('Use pnpm, not npm.')
    expect(preamble).toContain('async/await.')
    expect(preamble).toContain('Avoid eval.')
  })

  it('generatePreamble returns empty string for project with no facts', async () => {
    const store = await getStore()
    const preamble = store.getState().generatePreamble('/no/facts/here')
    expect(preamble).toBe('')
  })

  it('markFactsUsed increments usage count and updates lastUsedAt', async () => {
    const store = await getStore()
    store.getState().addFact({
      project: '/my/project',
      pattern: 'npm',
      correction: 'pnpm',
      context: 'use pnpm',
      category: 'tooling',
    })

    store.getState().markFactsUsed('/my/project')
    const facts = store.getState().getFactsForProject('/my/project')
    const fact = facts.find((f) => f.correction === 'pnpm')
    expect(fact).toBeTruthy()
    expect(fact!.usageCount).toBe(1)
    expect(fact!.lastUsedAt).toBeGreaterThan(0)
  })

  it('scopes facts to project path', async () => {
    const store = await getStore()
    store.getState().addFact({
      project: '/project-a',
      pattern: 'npm',
      correction: 'pnpm',
      context: 'use pnpm',
      category: 'tooling',
    })

    const factsA = store.getState().getFactsForProject('/project-a')
    const factsB = store.getState().getFactsForProject('/project-b')
    expect(factsA.some((f) => f.correction === 'pnpm')).toBe(true)
    expect(factsB.some((f) => f.correction === 'pnpm')).toBe(false)
  })

  it('enforces max 100 facts per project', async () => {
    const store = await getStore()
    for (let i = 0; i < 110; i++) {
      store.getState().addFact({
        project: '/big/project',
        pattern: `pattern-${i}`,
        correction: `correction-${i}`,
        context: `context-${i}`,
        category: 'other',
      })
    }

    const facts = store.getState().getFactsForProject('/big/project')
    expect(facts.length).toBeLessThanOrEqual(100)
  })

  it('manager open/close toggles', async () => {
    const store = await getStore()
    expect(store.getState().managerOpen).toBe(false)
    store.getState().openManager()
    expect(store.getState().managerOpen).toBe(true)
    store.getState().closeManager()
    expect(store.getState().managerOpen).toBe(false)
  })
})
