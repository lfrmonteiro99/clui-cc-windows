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
