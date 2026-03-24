export interface Migration {
  version: number
  name: string
  up: (db: any) => void
}

export interface ProjectRow {
  id: string
  name: string
  root_path: string
  repo_remote: string | null
  created_at: string
  updated_at: string
}

export interface SessionUpdate {
  claude_session_id?: string
  title?: string
  goal?: string
  branch_name?: string
  commit_sha_start?: string
  commit_sha_end?: string
  status?: string
  ended_at?: string
  pinned?: number
}

export interface MemoryInsert {
  projectId: string
  sessionId: string | null
  memoryType: string
  scope: string
  title: string
  body: string | null
  sourceRefsJson: string | null
  importanceScore: number
  confidenceScore: number
}

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

export interface MemoryPacketConfig {
  maxTokens: number
  maxRecentSessions: number
  maxMemories: number
  maxActiveFiles: number
  minImportanceScore: number
}

export const DEFAULT_MEMORY_PACKET_CONFIG: MemoryPacketConfig = {
  maxTokens: 2000,
  maxRecentSessions: 3,
  maxMemories: 8,
  maxActiveFiles: 10,
  minImportanceScore: 0.3,
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

// ── Smart Context Types ──────────────────────────────────────────────────

export enum ContextTier {
  ProjectState = 0,
  Continuation = 1,
  Decisions = 2,
  Pitfalls = 3,
  HotFiles = 4,
  Patterns = 5,
  RelevantMemories = 6,
  RecentSessions = 7,
}

export interface SmartMemoryPacketConfig {
  totalBudget: number
  tierBudgets: Partial<Record<ContextTier, number>>
  minDecisionImportance: number
  minPitfallImportance: number
  maxDecisions: number
  maxPitfalls: number
  maxPatterns: number
  cooccurrenceMinWeight: number
}

export const DEFAULT_SMART_PACKET_CONFIG: SmartMemoryPacketConfig = {
  totalBudget: 2000,
  tierBudgets: {
    [ContextTier.ProjectState]: 100,
    [ContextTier.Continuation]: 200,
    [ContextTier.Decisions]: 400,
    [ContextTier.Pitfalls]: 300,
    [ContextTier.HotFiles]: 150,
    [ContextTier.Patterns]: 200,
    [ContextTier.RelevantMemories]: 350,
    [ContextTier.RecentSessions]: 300,
  },
  minDecisionImportance: 0.4,
  minPitfallImportance: 0.3,
  maxDecisions: 5,
  maxPitfalls: 4,
  maxPatterns: 5,
  cooccurrenceMinWeight: 3.0,
}

export interface ScoredItem {
  id: string
  content: string
  estimatedTokens: number
  score: number
  tier: ContextTier
  sourceId: string
}

export interface PromptSignals {
  keyTerms: Set<string>
  mentionedFiles: string[]
  isContinuation: boolean
  expandedTerms: Set<string>
  intent: 'fix' | 'feature' | 'refactor' | 'question' | 'review' | 'general'
}

export interface DecisionRow {
  id: string
  project_id: string
  session_id: string
  title: string
  body: string
  category: string
  importance_score: number
  supersedes_id: string | null
  created_at: string
  deleted_at: string | null
}

export interface PitfallRow {
  id: string
  project_id: string
  session_id: string
  title: string
  body: string
  occurrence_count: number
  importance_score: number
  last_seen_at: string
  resolved: number
  created_at: string
  deleted_at: string | null
}

export interface UserPatternRow {
  id: string
  project_id: string
  pattern_type: string
  title: string
  body: string | null
  confidence_score: number
  observation_count: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}
