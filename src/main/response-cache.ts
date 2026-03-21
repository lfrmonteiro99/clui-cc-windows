// ─── Response Cache (Main Process) ───
// LRU cache with TTL for prompt→response pairs.

import { createHash } from 'crypto'

// ─── Types ───

export interface CacheEntry {
  key: string
  prompt: string
  response: string
  model: string
  projectPath: string
  costUsd: number
  cachedAt: number
  hitCount: number
}

export interface CacheConfig {
  maxEntries: number
  ttlMs: number
}

interface CacheStats {
  hits: number
  misses: number
  savedUsd: number
  entries: number
}

interface StoreInput {
  prompt: string
  response: string
  model: string
  projectPath: string
  costUsd: number
}

// ─── Normalization ───

const FILLER_PREFIX = /^(please\s+|can\s+you\s+|could\s+you\s+)/i

export function normalizePrompt(prompt: string): string {
  let normalized = prompt
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!]+$/, '')

  normalized = normalized.replace(FILLER_PREFIX, '')
  return normalized
}

function makeKey(normalizedPrompt: string, projectPath: string, model: string): string {
  const input = `${normalizedPrompt}|${projectPath}|${model}`
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

// ─── Cache ───

const DEFAULT_CONFIG: CacheConfig = {
  maxEntries: 200,
  ttlMs: 3_600_000, // 1 hour
}

export class ResponseCache {
  private entries = new Map<string, CacheEntry>()
  private config: CacheConfig
  private stats: CacheStats = { hits: 0, misses: 0, savedUsd: 0, entries: 0 }

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  store(input: StoreInput): void {
    const normalized = normalizePrompt(input.prompt)
    const key = makeKey(normalized, input.projectPath, input.model)

    this.entries.set(key, {
      key,
      prompt: input.prompt,
      response: input.response,
      model: input.model,
      projectPath: input.projectPath,
      costUsd: input.costUsd,
      cachedAt: Date.now(),
      hitCount: 0,
    })

    // LRU eviction: remove oldest entries if over limit
    while (this.entries.size > this.config.maxEntries) {
      const firstKey = this.entries.keys().next().value
      if (firstKey !== undefined) {
        this.entries.delete(firstKey)
      }
    }
  }

  lookup(prompt: string, projectPath: string, model: string): CacheEntry | null {
    const normalized = normalizePrompt(prompt)
    const key = makeKey(normalized, projectPath, model)

    const entry = this.entries.get(key)
    if (!entry) {
      this.stats.misses++
      return null
    }

    // TTL check
    if (Date.now() - entry.cachedAt > this.config.ttlMs) {
      this.entries.delete(key)
      this.stats.misses++
      return null
    }

    entry.hitCount++
    this.stats.hits++
    this.stats.savedUsd += entry.costUsd

    // Move to end for LRU (delete and re-insert)
    this.entries.delete(key)
    this.entries.set(key, entry)

    return entry
  }

  getStats(): CacheStats {
    return { ...this.stats, entries: this.entries.size }
  }

  clear(): void {
    this.entries.clear()
  }
}
