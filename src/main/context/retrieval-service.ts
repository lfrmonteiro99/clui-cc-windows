import type { DatabaseService } from './database-service'
import type {
  MemoryPacketConfig,
  MemorySearchResult,
  ProjectRow,
} from './types'
import { DEFAULT_MEMORY_PACKET_CONFIG } from './types'
import { PromptAnalyzer } from './prompt-analyzer'
import { scoreItem, computePromptMatch, extractKeyTokens } from './relevance-scorer'
import type {
  SmartMemoryPacketConfig,
  PromptSignals,
  DecisionRow,
  PitfallRow,
  UserPatternRow,
} from './types'
import type { GitFileStatus } from '../../shared/types'
import { DEFAULT_SMART_PACKET_CONFIG, ContextTier } from './types'
import type { GitFileStatus } from '../../shared/types'

// ── Raw row types from custom queries ────────────────────────────────────

interface RecentSessionRow {
  id: string
  title: string | null
  goal: string | null
  status: string
  started_at: string
  ended_at: string | null
  summary: string | null
}

interface SessionFileRow {
  path: string
  action: string
}

interface SessionToolRow {
  tool_name: string
}

interface MemoryRow {
  id: string
  memory_type: string
  scope: string
  title: string
  body: string | null
  importance_score: number
  confidence_score: number
  is_pinned: number
  access_count: number
  created_at: string
  updated_at: string
}

interface ActiveFileRow {
  path: string
  touch_count: number
  session_count: number
  actions: string
  last_touched: string
}

// ── Helpers ──────────────────────────────────────────────────────────────

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4)
}

/**
 * Intra-tier truncation: given a list of scored entries and a token budget,
 * keep only the highest-scoring entries that fit within the budget.
 * Entries are sorted by score (descending) and greedily packed.
 */
export function trimTier(
  entries: Array<{ content: string; score: number }>,
  budgetTokens: number,
): Array<{ content: string; score: number }> {
  const sorted = [...entries].sort((a, b) => b.score - a.score)
  let total = 0
  const kept: Array<{ content: string; score: number }> = []
  for (const entry of sorted) {
    const tokens = Math.ceil(entry.content.length / 4)
    if (total + tokens <= budgetTokens) {
      kept.push(entry)
      total += tokens
    }
  }
  return kept
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const remainder = s % 60
  return remainder > 0 ? `${m}m${remainder}s` : `${m}m`
}

/**
 * Sanitize a user prompt for FTS5 MATCH.
 * FTS5 interprets special characters (*, ", OR, AND, NOT, etc.) as operators.
 * We strip them and wrap each token in double quotes for exact matching.
 */
function sanitizeFtsQuery(query: string): string {
  // Remove characters that FTS5 treats as operators or syntax
  const cleaned = query.replace(/[*"():^{}[\]~\\<>]/g, ' ')
  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t.length > 0)
    // Remove FTS5 keywords
    .filter((t) => !['AND', 'OR', 'NOT', 'NEAR'].includes(t.toUpperCase()))
  if (tokens.length === 0) return ''
  // Quote each token individually to prevent FTS5 operator interpretation
  return tokens.map((t) => `"${t}"`).join(' ')
}

// ── RetrievalService ─────────────────────────────────────────────────────

export class RetrievalService {
  private readonly dbService: DatabaseService
  private promptAnalyzer: PromptAnalyzer | null = null

  constructor(db: DatabaseService) {
    this.dbService = db
  }

  private getAnalyzer(): PromptAnalyzer {
    if (!this.promptAnalyzer) {
      this.promptAnalyzer = new PromptAnalyzer(this.dbService.db)
    }
    return this.promptAnalyzer
  }

  /**
   * Resolve a filesystem path to its project ID in the database.
   * Uses the same normalization as DatabaseService.
   */
  resolveProjectId(projectPath: string): string | null {
    const project = this.dbService.getProjectByPath(projectPath)
    return project ? project.id : null
  }

  /**
   * Assemble an XML-tagged context block for prompt injection.
   * Returns null if no relevant data found for the project.
   */
  buildMemoryPacket(
    projectId: string,
    _tabId: string,
    prompt: string,
    config: MemoryPacketConfig = DEFAULT_MEMORY_PACKET_CONFIG,
  ): string | null {
    const db = this.dbService.db

    // ── 1. Project header (never trimmed) ──────────────────────────────
    const project = db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(projectId) as ProjectRow | undefined

    if (!project) return null

    const stats = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM sessions WHERE project_id = ? AND deleted_at IS NULL) as session_count,
          (SELECT COUNT(DISTINCT ft.path) FROM files_touched ft
           JOIN sessions s ON s.id = ft.session_id
           WHERE s.project_id = ? AND ft.deleted_at IS NULL AND s.deleted_at IS NULL) as unique_files_touched,
          (SELECT MAX(s.started_at) FROM sessions s WHERE s.project_id = ? AND s.deleted_at IS NULL) as last_active_at`,
      )
      .get(projectId, projectId, projectId) as {
      session_count: number
      unique_files_touched: number
      last_active_at: string | null
    }

    // If no sessions and no data at all, return null
    if (stats.session_count === 0) return null

    const projectSection = this.buildProjectSection(project, stats)

    // ── 2. Recent sessions ──────────────────────────────────────────────
    const sessionRows = db
      .prepare(
        `SELECT s.id, s.title, s.goal, s.status, s.started_at, s.ended_at,
                ss.body as summary
         FROM sessions s
         LEFT JOIN session_summaries ss ON ss.session_id = s.id AND ss.summary_kind = 'technical'
         WHERE s.project_id = ? AND s.deleted_at IS NULL AND s.status IN ('completed', 'dead')
         ORDER BY s.ended_at DESC LIMIT ?`,
      )
      .all(projectId, config.maxRecentSessions) as RecentSessionRow[]

    const sessionsSection = this.buildSessionsSection(db, sessionRows, config)

    // ── 3. Relevant memories ────────────────────────────────────────────
    const memoryRows = this.queryMemories(
      db,
      projectId,
      prompt,
      config.maxMemories,
      config.minImportanceScore,
    )

    const memoriesSection = this.buildMemoriesSection(memoryRows)

    // ── 4. Active files ─────────────────────────────────────────────────
    const activeFileRows = db
      .prepare(
        `SELECT ft.path, COUNT(*) as touch_count,
                COUNT(DISTINCT ft.session_id) as session_count,
                GROUP_CONCAT(DISTINCT ft.action) as actions,
                MAX(ft.created_at) as last_touched
         FROM files_touched ft JOIN sessions s ON ft.session_id = s.id
         WHERE s.project_id = ? AND ft.deleted_at IS NULL
         GROUP BY ft.path ORDER BY touch_count DESC, last_touched DESC LIMIT ?`,
      )
      .all(projectId, config.maxActiveFiles) as ActiveFileRow[]

    const filesSection = this.buildFilesSection(activeFileRows)

    // ── 5. Token budget enforcement ─────────────────────────────────────
    const sections = {
      project: projectSection,
      sessions: sessionsSection,
      memories: memoriesSection,
      files: filesSection,
    }

    const packet = this.enforceTokenBudget(
      sections,
      config,
      db,
      projectId,
      prompt,
      sessionRows,
      memoryRows,
      activeFileRows,
    )

    // ── 6. Track memory access ──────────────────────────────────────────
    if (memoryRows.length > 0) {
      const ids = memoryRows.map((m) => m.id)
      const placeholders = ids.map(() => '?').join(', ')
      db.prepare(
        `UPDATE memories SET access_count = access_count + 1, last_accessed_at = datetime('now')
         WHERE id IN (${placeholders})`,
      ).run(...ids)
    }

    return packet
  }

  /**
   * Full-text search for memories (for UI display, not packet assembly).
   */
  searchMemories(
    projectId: string,
    query: string,
    limit: number,
  ): MemorySearchResult[] {
    const db = this.dbService.db

    const ftsQuery = sanitizeFtsQuery(query)
    if (ftsQuery) {
      try {
        const rows = db
          .prepare(
            `SELECT m.id, m.memory_type, m.scope, m.title, m.body, m.importance_score,
                    m.confidence_score, m.is_pinned, m.access_count, m.created_at, m.updated_at
             FROM memories m
             JOIN memory_fts ON memory_fts.rowid = m.rowid
             WHERE m.project_id = ? AND m.deleted_at IS NULL
               AND memory_fts MATCH ?
             ORDER BY m.is_pinned DESC, rank * m.importance_score DESC
             LIMIT ?`,
          )
          .all(projectId, ftsQuery, limit) as MemoryRow[]

        return rows.map(this.toMemorySearchResult)
      } catch {
        // FTS query failed, fall through to fallback
      }
    }

    // Fallback: no query or FTS failed
    const rows = db
      .prepare(
        `SELECT m.id, m.memory_type, m.scope, m.title, m.body, m.importance_score,
                m.confidence_score, m.is_pinned, m.access_count, m.created_at, m.updated_at
         FROM memories m
         WHERE m.project_id = ? AND m.deleted_at IS NULL
         ORDER BY m.is_pinned DESC, m.importance_score DESC, m.updated_at DESC
         LIMIT ?`,
      )
      .all(projectId, limit) as MemoryRow[]

    return rows.map(this.toMemorySearchResult)
  }

  /**
   * Smart context injection — prompt-aware, tiered, scored.
   * Falls back to legacy buildMemoryPacket if smart path fails.
   */
  buildSmartPacket(
    projectId: string,
    tabId: string,
    prompt: string,
    gitDiffFiles: string[] = [],
    config: SmartMemoryPacketConfig = DEFAULT_SMART_PACKET_CONFIG,
    gitBranch: string | null = null,
    gitFileStatuses: GitFileStatus[] = [],
  ): string | null {
    const db = this.dbService.db

    try {
      // 1. Analyze prompt
      const signals = this.getAnalyzer().analyze(prompt, projectId)

      // 2. Build project header (never trimmed)
      const project = db
        .prepare('SELECT * FROM projects WHERE id = ?')
        .get(projectId) as ProjectRow | undefined
      if (!project) return null

      const stats = db
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM sessions WHERE project_id = ? AND deleted_at IS NULL) as session_count,
            (SELECT COUNT(DISTINCT ft.path) FROM files_touched ft
             JOIN sessions s ON s.id = ft.session_id
             WHERE s.project_id = ? AND ft.deleted_at IS NULL AND s.deleted_at IS NULL) as unique_files_touched,
            (SELECT MAX(s.started_at) FROM sessions s WHERE s.project_id = ? AND s.deleted_at IS NULL) as last_active_at`,
        )
        .get(projectId, projectId, projectId) as {
        session_count: number
        unique_files_touched: number
        last_active_at: string | null
      }

      if (stats.session_count === 0) return null

      const projectSection = this.buildProjectSection(project, stats)

      // 3. Gather candidates per tier
      const continuation = this.queryContinuation(db, projectId, signals)
      const decisions = this.queryDecisions(db, projectId, signals, config)
      const pitfalls = this.queryPitfalls(db, projectId, signals, config)
      const hotFiles = this.queryHotFiles(db, projectId, signals, gitDiffFiles, config)
      const patterns = this.queryPatterns(db, projectId, config)
      const memories = this.queryScoredMemories(db, projectId, signals, gitDiffFiles, config)
      const sessions = this.queryRecentSessionsSmart(db, projectId, signals, config)
      const gitStatus = this.buildGitStatusTier(gitBranch, gitFileStatuses)

      // 4. Assemble with budget enforcement
      return this.assembleSmartPacket(
        projectSection,
        { continuation, decisions, pitfalls, hotFiles, patterns, memories, sessions, gitStatus },
        config,
      )
    } catch (err) {
      // Fallback to legacy
      return this.buildMemoryPacket(projectId, tabId, prompt)
    }
  }

  // ── Smart Packet: Tier Queries ────────────────────────────────────────

  private queryContinuation(
    db: any,
    projectId: string,
    signals: PromptSignals,
  ): string {
    if (!signals.isContinuation) {
      // Even without explicit continuation, show last session if recent
      const lastSession = db
        .prepare(
          `SELECT s.id, s.title, s.goal, s.status, s.started_at, s.ended_at
           FROM sessions s
           WHERE s.project_id = ? AND s.deleted_at IS NULL AND s.status IN ('completed', 'dead')
           ORDER BY s.ended_at DESC LIMIT 1`,
        )
        .get(projectId) as any

      if (!lastSession) return ''

      const hoursAgo =
        (Date.now() - new Date(lastSession.ended_at || lastSession.started_at).getTime()) / 3_600_000
      if (hoursAgo > 24) return '' // Too old for implicit continuation

      return `<continuation>
Last session: "${lastSession.goal || lastSession.title || 'N/A'}" (${lastSession.status}, ${Math.round(hoursAgo)}h ago)
</continuation>`
    }

    // Explicit continuation — get more detail about last session
    const lastSession = db
      .prepare(
        `SELECT s.id, s.title, s.goal, s.status, s.started_at, s.ended_at
         FROM sessions s
         WHERE s.project_id = ? AND s.deleted_at IS NULL
         ORDER BY COALESCE(s.ended_at, s.started_at) DESC LIMIT 1`,
      )
      .get(projectId) as any

    if (!lastSession) return ''

    // Get files from last session
    const files = db
      .prepare(
        `SELECT DISTINCT path, action FROM files_touched
         WHERE session_id = ? AND deleted_at IS NULL LIMIT 10`,
      )
      .all(lastSession.id) as Array<{ path: string; action: string }>

    const fileStr =
      files.length > 0
        ? files.map((f) => `${f.path} (${f.action})`).join(', ')
        : 'none'

    // Get user prompts from last session
    const prompts = db
      .prepare(
        `SELECT substr(content, 1, 200) as content FROM messages
         WHERE session_id = ? AND role = 'user' AND deleted_at IS NULL
         ORDER BY seq_num LIMIT 3`,
      )
      .all(lastSession.id) as Array<{ content: string }>

    const promptStr =
      prompts.length > 0
        ? prompts.map((p) => p.content).join(' → ')
        : 'N/A'

    return `<continuation>
Last session: "${lastSession.goal || lastSession.title || 'N/A'}" (${lastSession.status})
User prompts: ${promptStr}
Files touched: ${fileStr}
</continuation>`
  }

  private queryDecisions(
    db: any,
    projectId: string,
    signals: PromptSignals,
    config: SmartMemoryPacketConfig,
  ): string {
    const rows = db
      .prepare(
        `SELECT id, title, body, category, importance_score, created_at
         FROM decisions
         WHERE project_id = ? AND deleted_at IS NULL AND importance_score >= ?
         ORDER BY importance_score DESC LIMIT ?`,
      )
      .all(
        projectId,
        config.minDecisionImportance,
        config.maxDecisions,
      ) as DecisionRow[]

    if (rows.length === 0) return ''

    // Build scored entries for intra-tier trimming
    const scoredEntries = rows.map((d) => {
      const date = d.created_at.split(' ')[0]
      return {
        content: `<decision date="${date}" importance="${d.importance_score}">\n${d.body}\n</decision>`,
        score: d.importance_score,
      }
    })

    const tierBudget = config.tierBudgets[ContextTier.Decisions] ?? 400
    const trimmed = trimTier(scoredEntries, tierBudget)
    if (trimmed.length === 0) return ''

    return `<decisions count="${trimmed.length}">
${trimmed.map((e) => e.content).join('\n')}
</decisions>`
  }

  private queryPitfalls(
    db: any,
    projectId: string,
    signals: PromptSignals,
    config: SmartMemoryPacketConfig,
  ): string {
    const rows = db
      .prepare(
        `SELECT id, title, body, occurrence_count, importance_score, last_seen_at
         FROM pitfalls
         WHERE project_id = ? AND deleted_at IS NULL AND resolved = 0
           AND importance_score >= ?
         ORDER BY importance_score DESC LIMIT ?`,
      )
      .all(
        projectId,
        config.minPitfallImportance,
        config.maxPitfalls,
      ) as PitfallRow[]

    if (rows.length === 0) return ''

    // Build scored entries for intra-tier trimming
    const scoredEntries = rows.map((p) => ({
      content: `<pitfall importance="${p.importance_score}" occurrences="${p.occurrence_count}">\n${p.body}\n</pitfall>`,
      score: p.importance_score,
    }))

    const tierBudget = config.tierBudgets[ContextTier.Pitfalls] ?? 300
    const trimmed = trimTier(scoredEntries, tierBudget)
    if (trimmed.length === 0) return ''

    return `<pitfalls count="${trimmed.length}">
${trimmed.map((e) => e.content).join('\n')}
</pitfalls>`
  }

  private queryHotFiles(
    db: any,
    projectId: string,
    signals: PromptSignals,
    gitDiffFiles: string[],
    config: SmartMemoryPacketConfig,
  ): string {
    const rows = db
      .prepare(
        `SELECT ft.path, COUNT(*) as touch_count,
                COUNT(DISTINCT ft.session_id) as session_count,
                MAX(ft.created_at) as last_touched
         FROM files_touched ft JOIN sessions s ON ft.session_id = s.id
         WHERE s.project_id = ? AND ft.deleted_at IS NULL
         GROUP BY ft.path ORDER BY touch_count DESC, last_touched DESC LIMIT 10`,
      )
      .all(projectId) as ActiveFileRow[]

    if (rows.length === 0) return ''

    // Score files by relevance
    const projectState = {
      gitDiffFiles,
      recentlyOpenedFiles: [] as string[],
    }

    const scored = rows.map((f) => ({
      ...f,
      score: scoreItem(
        {
          updatedAt: f.last_touched,
          importanceScore: Math.min(0.9, 0.3 + f.touch_count * 0.05),
          searchableText: f.path,
          associatedFiles: [f.path],
          accessCount: f.touch_count,
        },
        signals.keyTerms.size > 0 ? [...signals.keyTerms].join(' ') : '',
        projectState,
      ),
    }))

    scored.sort((a, b) => b.score - a.score)
    const topFiles = scored.slice(0, 5)

    // Build scored entries for intra-tier trimming
    const scoredEntries = topFiles.map((f) => {
      const sessionLabel =
        f.session_count === 1 ? '1 session' : `${f.session_count} sessions`
      return {
        content: `${f.path} — ${f.touch_count} times across ${sessionLabel}`,
        score: f.score,
      }
    })

    const tierBudget = config.tierBudgets[ContextTier.HotFiles] ?? 150
    const trimmed = trimTier(scoredEntries, tierBudget)
    if (trimmed.length === 0) return ''

    return `<hot_files count="${trimmed.length}">
${trimmed.map((e) => e.content).join('\n')}
</hot_files>`
  }

  private queryPatterns(
    db: any,
    projectId: string,
    config: SmartMemoryPacketConfig,
  ): string {
    const rows = db
      .prepare(
        `SELECT pattern_type, title, body, confidence_score
         FROM user_patterns
         WHERE project_id = ? AND deleted_at IS NULL
         ORDER BY confidence_score DESC LIMIT ?`,
      )
      .all(projectId, config.maxPatterns) as UserPatternRow[]

    if (rows.length === 0) return ''

    // Build scored entries for intra-tier trimming
    const scoredEntries = rows.map((p) => ({
      content: `<pattern type="${p.pattern_type}">${p.title}${p.body ? ': ' + p.body : ''}</pattern>`,
      score: p.confidence_score,
    }))

    const tierBudget = config.tierBudgets[ContextTier.Patterns] ?? 200
    const trimmed = trimTier(scoredEntries, tierBudget)
    if (trimmed.length === 0) return ''

    return `<patterns count="${trimmed.length}">
${trimmed.map((e) => e.content).join('\n')}
</patterns>`
  }

  private queryScoredMemories(
    db: any,
    projectId: string,
    signals: PromptSignals,
    gitDiffFiles: string[],
    config: SmartMemoryPacketConfig,
  ): string {
    // Get candidate memories
    const memoryRows = this.queryMemories(
      db,
      projectId,
      [...signals.keyTerms, ...signals.expandedTerms].join(' '),
      12, // Fetch more than needed for scoring
      config.minDecisionImportance,
    )

    if (memoryRows.length === 0) return ''

    const projectState = { gitDiffFiles, recentlyOpenedFiles: [] as string[] }
    const prompt = signals.keyTerms.size > 0 ? [...signals.keyTerms].join(' ') : ''

    // Score and sort
    const scored = memoryRows.map((m) => ({
      ...m,
      score: scoreItem(
        {
          updatedAt: m.updated_at,
          importanceScore: m.importance_score,
          searchableText: `${m.title} ${m.body || ''}`,
          associatedFiles: [],
          accessCount: m.access_count,
        },
        prompt,
        projectState,
      ),
    }))

    scored.sort((a, b) => b.score - a.score)
    const topMemories = scored.slice(0, 6)

    // Track access
    if (topMemories.length > 0) {
      const ids = topMemories.map((m) => m.id)
      const placeholders = ids.map(() => '?').join(', ')
      db.prepare(
        `UPDATE memories SET access_count = access_count + 1, last_accessed_at = datetime('now')
         WHERE id IN (${placeholders})`,
      ).run(...ids)
    }

    // Build scored entries for intra-tier trimming
    const scoredEntries = topMemories.map((m) => {
      const created = m.created_at.split(' ')[0]
      const content = m.body || m.title
      return {
        content: `<memory type="${m.memory_type}" importance="${m.importance_score}" created="${created}">\n${content}\n</memory>`,
        score: m.score,
      }
    })

    const tierBudget = config.tierBudgets[ContextTier.RelevantMemories] ?? 350
    const trimmed = trimTier(scoredEntries, tierBudget)
    if (trimmed.length === 0) return ''

    return `<relevant_memories count="${trimmed.length}">
${trimmed.map((e) => e.content).join('\n')}
</relevant_memories>`
  }

  private queryRecentSessionsSmart(
    db: any,
    projectId: string,
    signals: PromptSignals,
    config: SmartMemoryPacketConfig,
  ): string {
    // Only include 1 recent session (vs. 3 in legacy) — other tiers carry the context
    const sessionRows = db
      .prepare(
        `SELECT s.id, s.title, s.goal, s.status, s.started_at, s.ended_at,
                ss.body as summary
         FROM sessions s
         LEFT JOIN session_summaries ss ON ss.session_id = s.id AND ss.summary_kind = 'technical'
         WHERE s.project_id = ? AND s.deleted_at IS NULL AND s.status IN ('completed', 'dead')
         ORDER BY s.ended_at DESC LIMIT 1`,
      )
      .all(projectId) as RecentSessionRow[]

    return this.buildSessionsSection(db, sessionRows, {
      ...DEFAULT_MEMORY_PACKET_CONFIG,
      maxRecentSessions: 1,
    })
  }

  // ── Smart Packet: Git Status Tier ────────────────────────────────────

  /** Max number of file paths to include in the git_status tier (~155 tokens) */
  private static readonly GIT_STATUS_FILE_CAP = 15

  /**
   * Build a <git_status> XML tier from branch name and changed files.
   * Returns empty string if there is no meaningful git info.
   */
  buildGitStatusTier(branch: string | null, files: GitFileStatus[]): string {
    if (!branch && files.length === 0) return ''

    const capped = files.slice(0, RetrievalService.GIT_STATUS_FILE_CAP)
    const overflow = files.length - capped.length

    const lines = capped.map((f) => `${f.status} ${f.path}`)
    if (overflow > 0) {
      lines.push(`...and ${overflow} more`)
    }

    const branchAttr = branch ? ` branch="${branch}"` : ''
    return `<git_status${branchAttr} file_count="${capped.length}">
${lines.join('\n')}
</git_status>`
  }

  // ── Smart Packet: Assembly ────────────────────────────────────────────

  private assembleSmartPacket(
    projectSection: string,
    tiers: {
      continuation: string
      decisions: string
      pitfalls: string
      hotFiles: string
      patterns: string
      memories: string
      sessions: string
      gitStatus: string
    },
    config: SmartMemoryPacketConfig,
  ): string {
    const parts = ['<clui_context>', projectSection]

    if (tiers.gitStatus) parts.push(tiers.gitStatus)
    if (tiers.continuation) parts.push(tiers.continuation)
    if (tiers.decisions) parts.push(tiers.decisions)
    if (tiers.pitfalls) parts.push(tiers.pitfalls)
    if (tiers.hotFiles) parts.push(tiers.hotFiles)
    if (tiers.patterns) parts.push(tiers.patterns)
    if (tiers.memories) parts.push(tiers.memories)
    if (tiers.sessions) parts.push(tiers.sessions)

    parts.push('</clui_context>')

    let result = parts.join('\n\n')
    let tokens = estimateTokens(result)

    if (tokens <= config.totalBudget) return result

    // Trim tiers in order: sessions → memories → patterns → hotFiles → pitfalls → decisions → gitStatus → continuation
    const trimOrder: (keyof typeof tiers)[] = [
      'sessions',
      'memories',
      'patterns',
      'hotFiles',
      'pitfalls',
      'decisions',
      'gitStatus',
      'continuation',
    ]

    for (const tier of trimOrder) {
      if (tokens <= config.totalBudget) break
      if (tiers[tier]) {
        tokens -= estimateTokens(tiers[tier])
        tiers[tier] = ''
        // Rebuild
        const rebuiltParts = ['<clui_context>', projectSection]
        if (tiers.gitStatus) rebuiltParts.push(tiers.gitStatus)
        if (tiers.continuation) rebuiltParts.push(tiers.continuation)
        if (tiers.decisions) rebuiltParts.push(tiers.decisions)
        if (tiers.pitfalls) rebuiltParts.push(tiers.pitfalls)
        if (tiers.hotFiles) rebuiltParts.push(tiers.hotFiles)
        if (tiers.patterns) rebuiltParts.push(tiers.patterns)
        if (tiers.memories) rebuiltParts.push(tiers.memories)
        if (tiers.sessions) rebuiltParts.push(tiers.sessions)
        rebuiltParts.push('</clui_context>')
        result = rebuiltParts.join('\n\n')
        tokens = estimateTokens(result)
      }
    }

    return result
  }

  // ── Private: Section builders ──────────────────────────────────────────

  private buildProjectSection(
    project: ProjectRow,
    stats: {
      session_count: number
      unique_files_touched: number
      last_active_at: string | null
    },
  ): string {
    const lastActive = stats.last_active_at
      ? stats.last_active_at.split(' ')[0]
      : 'N/A'

    return `<project name="${project.name}" path="${project.root_path}">
Last active: ${lastActive}
Sessions: ${stats.session_count} | Files touched: ${stats.unique_files_touched} unique paths
</project>`
  }

  private buildSessionsSection(
    db: any,
    sessionRows: RecentSessionRow[],
    config: MemoryPacketConfig,
  ): string {
    if (sessionRows.length === 0) return ''

    const sessionEntries = sessionRows.map((s) => {
      // Get files for this session
      const files = db
        .prepare(
          `SELECT DISTINCT path, action FROM files_touched
           WHERE session_id = ? AND deleted_at IS NULL`,
        )
        .all(s.id) as SessionFileRow[]

      // Get tools for this session
      const tools = db
        .prepare(
          `SELECT DISTINCT
             CASE
               WHEN payload_json IS NOT NULL THEN json_extract(payload_json, '$.toolName')
               ELSE event_type
             END as tool_name
           FROM events
           WHERE session_id = ? AND event_type IN ('tool_call', 'tool_call_complete') AND deleted_at IS NULL`,
        )
        .all(s.id) as SessionToolRow[]

      const date = s.ended_at
        ? s.ended_at.split(' ')[0]
        : s.started_at.split(' ')[0]
      let durationStr = ''
      if (s.started_at && s.ended_at) {
        const ms =
          new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()
        if (ms > 0) durationStr = ` duration="${formatDuration(ms)}"`
      }

      // Get user prompts for this session (key context)
      const userMessages = db
        .prepare(
          `SELECT substr(content, 1, 200) as content FROM messages
           WHERE session_id = ? AND role = 'user' AND deleted_at IS NULL
           ORDER BY seq_num LIMIT 5`,
        )
        .all(s.id) as Array<{ content: string }>

      const goal = s.goal || s.title || 'N/A'
      const fileList =
        files.length > 0
          ? files.map((f) => `${f.path} (${f.action})`).join(', ')
          : 'none'
      const toolList =
        tools.length > 0
          ? tools
              .map((t) => t.tool_name)
              .filter(Boolean)
              .join(', ')
          : 'none'
      const summary = s.summary || 'No summary available.'
      const userPromptsStr = userMessages.length > 0
        ? userMessages.map((m) => m.content).join(' | ')
        : 'N/A'

      return `<session id="${s.id}" date="${date}" status="${s.status}"${durationStr}>
Goal: ${goal}
User prompts: ${userPromptsStr}
Files: ${fileList}
Tools: ${toolList}
Summary: ${summary}
</session>`
    })

    return `<recent_sessions max="${config.maxRecentSessions}">
${sessionEntries.join('\n')}
</recent_sessions>`
  }

  private buildMemoriesSection(memoryRows: MemoryRow[]): string {
    if (memoryRows.length === 0) return ''

    const entries = memoryRows.map((m) => {
      const created = m.created_at.split(' ')[0]
      const content = m.body || m.title
      return `<memory type="${m.memory_type}" importance="${m.importance_score}" created="${created}">
${content}
</memory>`
    })

    return `<relevant_memories count="${memoryRows.length}">
${entries.join('\n')}
</relevant_memories>`
  }

  private buildFilesSection(activeFileRows: ActiveFileRow[]): string {
    if (activeFileRows.length === 0) return ''

    const entries = activeFileRows.map((f) => {
      const actions = f.actions ? f.actions.split(',') : []
      const parts: string[] = []
      for (const action of actions) {
        // Count how many of this action (approximate from total)
        parts.push(action)
      }
      const sessionLabel =
        f.session_count === 1
          ? '1 session'
          : `${f.session_count} sessions`
      return `${f.path} — ${parts.join(', ')} ${f.touch_count} times across ${sessionLabel}`
    })

    return `<active_files count="${activeFileRows.length}">
${entries.join('\n')}
</active_files>`
  }

  // ── Private: Memory queries ────────────────────────────────────────────

  private queryMemories(
    db: any,
    projectId: string,
    prompt: string,
    limit: number,
    minImportance: number,
  ): MemoryRow[] {
    // Try FTS search first if there's a prompt
    if (prompt && prompt.trim().length > 0) {
      const ftsQuery = sanitizeFtsQuery(prompt)
      if (ftsQuery) {
        try {
          const rows = db
            .prepare(
              `SELECT m.id, m.memory_type, m.scope, m.title, m.body, m.importance_score,
                      m.confidence_score, m.is_pinned, m.access_count, m.created_at, m.updated_at
               FROM memories m
               JOIN memory_fts ON memory_fts.rowid = m.rowid
               WHERE m.project_id = ? AND m.deleted_at IS NULL AND m.importance_score >= ?
                 AND memory_fts MATCH ?
               ORDER BY m.is_pinned DESC, rank * m.importance_score DESC
               LIMIT ?`,
            )
            .all(projectId, minImportance, ftsQuery, limit) as MemoryRow[]

          if (rows.length > 0) return rows
        } catch {
          // FTS failed, fall through to fallback
        }
      }
    }

    // Fallback: importance + recency
    return db
      .prepare(
        `SELECT m.id, m.memory_type, m.scope, m.title, m.body, m.importance_score,
                m.confidence_score, m.is_pinned, m.access_count, m.created_at, m.updated_at
         FROM memories m
         WHERE m.project_id = ? AND m.deleted_at IS NULL AND m.importance_score >= ?
         ORDER BY m.is_pinned DESC, m.importance_score DESC, m.updated_at DESC
         LIMIT ?`,
      )
      .all(projectId, minImportance, limit) as MemoryRow[]
  }

  // ── Private: Token budget enforcement ──────────────────────────────────

  private enforceTokenBudget(
    sections: {
      project: string
      sessions: string
      memories: string
      files: string
    },
    config: MemoryPacketConfig,
    db: any,
    projectId: string,
    prompt: string,
    sessionRows: RecentSessionRow[],
    memoryRows: MemoryRow[],
    activeFileRows: ActiveFileRow[],
  ): string {
    const wrap = (s: typeof sections) => {
      const parts = ['<clui_context>', s.project]
      if (s.sessions) parts.push(s.sessions)
      if (s.memories) parts.push(s.memories)
      if (s.files) parts.push(s.files)
      parts.push('</clui_context>')
      return parts.join('\n\n')
    }

    let result = wrap(sections)
    let tokens = estimateTokens(result)

    if (tokens <= config.maxTokens) return result

    // Priority 1: Trim active files (reduce count)
    let fileCount = activeFileRows.length
    while (tokens > config.maxTokens && fileCount > 0) {
      fileCount--
      const trimmedFiles = this.buildFilesSection(
        activeFileRows.slice(0, fileCount),
      )
      result = wrap({ ...sections, files: trimmedFiles })
      tokens = estimateTokens(result)
    }

    if (tokens <= config.maxTokens) return result

    // Priority 2: Trim memories (reduce count from bottom / lowest scoring)
    let memoryCount = memoryRows.length
    while (tokens > config.maxTokens && memoryCount > 0) {
      memoryCount--
      const trimmedMemories = this.buildMemoriesSection(
        memoryRows.slice(0, memoryCount),
      )
      result = wrap({ ...sections, files: '', memories: trimmedMemories })
      tokens = estimateTokens(result)
    }

    if (tokens <= config.maxTokens) return result

    // Priority 3: Trim sessions (reduce count, oldest first — they're already ordered newest first)
    let sessionCount = sessionRows.length
    while (tokens > config.maxTokens && sessionCount > 0) {
      sessionCount--
      const trimmedSessions = this.buildSessionsSection(
        db,
        sessionRows.slice(0, sessionCount),
        config,
      )
      result = wrap({
        ...sections,
        files: '',
        memories: '',
        sessions: trimmedSessions,
      })
      tokens = estimateTokens(result)
    }

    return result
  }

  // ── Private: Row to result mapping ─────────────────────────────────────

  private toMemorySearchResult(row: MemoryRow): MemorySearchResult {
    return {
      id: row.id,
      memoryType: row.memory_type,
      scope: row.scope,
      title: row.title,
      body: row.body,
      importanceScore: row.importance_score,
      confidenceScore: row.confidence_score,
      isPinned: row.is_pinned === 1,
      accessCount: row.access_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}
