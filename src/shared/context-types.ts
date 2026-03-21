// ─── Context Database Types (shared across main/preload/renderer) ───
// These are re-exported from src/main/context/types.ts to avoid
// cross-boundary imports between main and renderer/preload layers.

export interface ContextSessionSummary {
  id: string
  title: string | null
  goal: string | null
  status: string
  startedAt: string
  endedAt: string | null
  filesTouchedCount: number
  toolsUsed: string[]
  costUsd: number | null
  durationMs: number | null
  summary: string | null
}

export interface ContextProjectStats {
  projectId: string
  projectName: string
  sessionCount: number
  totalCostUsd: number
  uniqueFilesTouched: number
  memoryCount: number
  lastActiveAt: string | null
}

export interface ContextFileTouched {
  path: string
  totalTouches: number
  actions: string[]
  lastTouched: string
  sessionCount: number
}

export interface ContextMemory {
  id: string
  memoryType: string
  scope: string
  title: string
  body: string | null
  importanceScore: number
  confidenceScore: number
  isPinned: boolean
  accessCount: number
  createdAt: string
  updatedAt: string
}

export interface MemorySearchResult {
  id: string
  memoryType: string
  scope: string
  title: string
  body: string | null
  importanceScore: number
  confidenceScore: number
  isPinned: boolean
  accessCount: number
  createdAt: string
  updatedAt: string
}

// ── Smart Context Types (shared) ─────────────────────────────────────────

export interface ContextDecision {
  id: string
  title: string
  body: string
  category: string
  importanceScore: number
  sessionId: string
  createdAt: string
}

export interface ContextPitfall {
  id: string
  title: string
  body: string
  occurrenceCount: number
  importanceScore: number
  lastSeenAt: string
  resolved: boolean
}

export interface ContextUserPattern {
  id: string
  patternType: string
  title: string
  body: string | null
  confidenceScore: number
  observationCount: number
}
