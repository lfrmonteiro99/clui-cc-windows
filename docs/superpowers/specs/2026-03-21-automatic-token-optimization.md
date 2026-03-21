# Automatic Token Optimization — Technical Specification

> **Goal:** Reduce token waste by 40-60% without any user intervention.
> **Principle:** The user never needs to know this exists. It just works.

---

## Executive Summary

Analysis of the CLUI CC token flow reveals 4 systemic waste sources that compound in long/multi-session workflows:

| Waste Source | Where | Estimated Overhead |
|---|---|---|
| Stale context in long sessions | CLI `--resume` accumulates all history | 30-80K tokens/session after 30+ turns |
| Cold-start re-explanation tax | New sessions start without project context | 5-15K tokens wasted per new tab |
| Redundant file/git context | Same files & git state re-sent every run | 2-8K tokens per resumed run |
| Invisible context exhaustion | Users don't know when to start fresh | Cascading quality degradation |

**Total potential savings: 60-250K tokens/day for power users (15-30% reduction).**

---

## Architecture: Token Optimization Layer

```
┌──────────────────────────────────────────────────────────────────┐
│                        OPTIMIZATION LAYER                         │
│                                                                    │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────┐ │
│  │ Context Pruning  │  │  Smart Injection  │  │ Adaptive Scope  │ │
│  │ Orchestrator     │  │  Engine           │  │ Engine          │ │
│  │                  │  │                   │  │                 │ │
│  │ • Session aging  │  │ • Prompt-aware    │  │ • Hot file set  │ │
│  │ • Fork decision  │  │   context select  │  │ • Dir covering  │ │
│  │ • Summary gen    │  │ • Priority tiers  │  │ • Git caching   │ │
│  │ • Token stats    │  │ • Token budgeted  │  │ • Change detect │ │
│  └────────┬────────┘  └────────┬─────────┘  └────────┬────────┘ │
│           │                     │                      │          │
│  ┌────────▼─────────────────────▼──────────────────────▼────────┐│
│  │              Existing Infrastructure                          ││
│  │  ControlPlane._dispatch() → RunManager → CLI spawn           ││
│  │  IngestionService → SQLite context.db → RetrievalService     ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Context Health Monitor (Renderer)                            │ │
│  │  • Per-tab utilization indicator                              │ │
│  │  • Auto-triggers at 70%/85% thresholds                       │ │
│  │  • "Start fresh with context" one-click action                │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## System 1: Automatic Context Pruning

### Problem
The CLI's `--resume <sessionId>` accumulates ALL conversation history internally. After 30+ turns, input tokens are dominated by stale context (abandoned approaches, redundant file reads, completed tool chains). CLUI cannot edit CLI-internal history.

### Solution: Intelligent Session Forking
Instead of editing CLI history, the system decides when to **fork** — starting a fresh CLI session with a heuristic summary injected via `--system-prompt`, instead of resuming the bloated session.

### Staleness Scoring Formula

```
Score(session) = 0.5 × tokenFactor + 0.3 × turnFactor + 0.2 × ageFactor

Where:
  tokenFactor = min(1, estimatedInputTokens / 80000)
  turnFactor  = min(1, totalTurns / 30)
  ageFactor   = min(1, minutesSinceLastActivity / 60)

Bonuses:
  +0.1 if redundant file reads > 5
  +0.1 if error tool chains > 3
```

**Fork threshold: score ≥ 0.7**

### Fork Summary Generation (Heuristic, No LLM)

When forking, generate a structured summary from existing DB data:

```xml
<session_context continuation="true">
Previous goal: {session.goal || session.title}
Key files: {files_touched.map(f => f.path).join(', ')}
Accomplished: {session_summaries.body}
Key learnings:
- {memories.map(m => m.title).join('\n- ')}
Recent requests: {last_5_user_messages.map(m => m.content.slice(0, 100)).join(' | ')}
</session_context>
```

**Cost: 200-500 tokens (summary) vs 30-80K tokens (full resumed context)**

### Integration Point

**File:** `src/main/claude/control-plane.ts` → `_dispatch()` (line ~692)

```typescript
// Before existing resume logic:
if (tab.claudeSessionId && !options.sessionId) {
  const decision = this.pruningOrchestrator?.evaluate(
    tab.claudeSessionId, tab.promptCount, options.projectPath
  )
  if (decision?.action === 'fork') {
    tab.claudeSessionId = null  // forces new session
    options.systemPrompt = [options.systemPrompt, decision.summary]
      .filter(Boolean).join('\n\n')
  } else {
    options.sessionId = tab.claudeSessionId
  }
}
```

### New Files
| File | Purpose |
|------|---------|
| `src/main/context/pruning/pruning-orchestrator.ts` | Central evaluate() + buildForkSummary() |
| `src/main/context/pruning/session-age-analyzer.ts` | Staleness scoring |

### Modified Files
| File | Change |
|------|--------|
| `src/main/claude/control-plane.ts` | Add pruningOrchestrator, modify _dispatch() |
| `src/main/context/ingestion-service.ts` | Record token stats in handleTaskComplete() |
| `src/main/context/database-service.ts` | Add insertTokenStats(), getTokenStats() |
| `src/main/index.ts` | Wire PruningOrchestrator at startup |

### Token Savings
- 2-3 forks/day × 30-80K tokens saved = **60-240K tokens/day**

---

## System 2: Smart Cross-Session Context Injection

### Problem
New sessions/tabs start cold. Users spend 5-15 exchanges re-explaining codebase, constraints, and decisions already made in previous sessions.

### Solution: Tiered Context Packet with Prompt-Aware Selection

Replace the current flat memory packet with a priority-tiered, prompt-aware injection:

```
[CONTEXT: CONTINUATION SIGNAL]        ← Tier 0 (300 tokens, weight 1.0)
Last session goal + status + pending work

[CONTEXT: RELEVANT DECISIONS]          ← Tier 1 (600 tokens, weight 0.9)
Architecture choices, pattern decisions from past sessions

[CONTEXT: ACTIVE PITFALLS]             ← Tier 2 (400 tokens, weight 0.85)
Errors encountered, things that didn't work

[CONTEXT: HOT FILES]                   ← Tier 3 (300 tokens, weight 0.7)
Most actively touched files with frequency data

[CONTEXT: PATTERN MEMORY]              ← Tier 4 (400 tokens, weight 0.6)
User preferences, coding patterns, tool preferences

[CONTEXT: PROJECT STATE]               ← Tier 5 (200 tokens, weight 0.5)
Branch, session count, last active

Total budget: 3000 tokens (configurable)
```

### Relevance Scoring Algorithm

Each candidate context item gets a composite score:

```
score = 0.30 × promptMatch    // Jaccard token overlap with current prompt
      + 0.25 × recency        // Exponential decay, halfLife=48h
      + 0.25 × importance      // DB importance_score (1-10) / 10
      + 0.15 × fileOverlap     // Files in prompt vs files in memory
      + 0.05 × frequency       // min(touchCount/20, 1.0)
```

**Prompt matching** uses token overlap (Jaccard) + a lightweight co-occurrence map built during ingestion. No LLM calls needed.

### New DB Tables

```sql
-- Co-occurrence map for prompt matching (built during ingestion)
CREATE TABLE IF NOT EXISTS term_cooccurrence (
  term_a     TEXT NOT NULL,
  term_b     TEXT NOT NULL,
  weight     REAL NOT NULL DEFAULT 1.0,
  project_id TEXT NOT NULL REFERENCES projects(id),
  PRIMARY KEY (project_id, term_a, term_b)
);

-- Index for fast lookup
CREATE INDEX idx_cooccurrence_lookup
  ON term_cooccurrence(project_id, term_a);
```

### Integration Point

**File:** `src/main/context/retrieval-service.ts` → `buildMemoryPacket()`

Enhanced to accept the current prompt and use relevance scoring:

```typescript
async buildMemoryPacket(
  projectPath: string,
  prompt?: string,           // NEW: current user prompt
  config?: MemoryPacketConfig
): Promise<string> {
  // ... existing project resolution ...

  // NEW: Score and select by tier instead of flat assembly
  const tiers = await this.buildTieredContext(projectId, prompt, config)
  return this.assembleWithBudget(tiers, config.maxTokens)
}
```

### Token Savings
- Eliminates 5-15 re-explanation exchanges per new session
- At ~500 tokens/exchange = **2.5-7.5K tokens saved per new session**
- For 5+ sessions/day = **12-37K tokens/day**

---

## System 3: Adaptive File Context Scoping

### Problem
On large projects, Claude's initial exploration burns 5-15K tokens reading directory trees and files it won't use. Auto-attach files re-sent on every run even if unchanged.

### Solution: Per-Project Hot File Set + Change Detection

#### Hot File Scoring

```sql
SELECT file_path,
  SUM(
    CASE action
      WHEN 'write' THEN 1.0  WHEN 'patch' THEN 0.9
      WHEN 'read'  THEN 0.3  WHEN 'delete' THEN 0.1
    END
    * EXP(-((JULIANDAY('now') - JULIANDAY(touched_at)) * 24.0) / 168.0)
  ) AS score
FROM files_touched WHERE project_hash = ?
GROUP BY file_path HAVING score > 0.05
ORDER BY score DESC LIMIT 50
```

#### Directory Cover Algorithm
1. Build trie from hot file paths with cumulative scores
2. Emit directory nodes where score ≥ 2.0 AND descendant count ≥ 2
3. Deduplicate (remove subdirectories of emitted parents)
4. Cap at 8 directories, merge lowest siblings if exceeded

#### Git Context Caching

```typescript
interface GitContextCache {
  headCommit: string           // git rev-parse HEAD
  dirtyHash: string            // sha256(git status --porcelain)
  fetchedAt: number
  context: GitContext
}
// Invalidate if HEAD or dirtyHash changed, or age > 60s
```

#### Auto-Attach Change Detection

```typescript
// Within resumed sessions only:
for (const attachment of autoAttachments) {
  const currentHash = await hashFile(attachment.path)
  if (meta.contentHash === currentHash && meta.lastSentSession === sessionId) {
    continue  // Skip — CLI already has this content
  }
  args.push('--add-dir', attachment.path)
}
```

### New Files
| File | Purpose |
|------|---------|
| `src/main/context-scoper.ts` | computeScopedContext() + directory cover algorithm |
| `src/main/git-context-cache.ts` | Cache layer for git context |

### Modified Files
| File | Change |
|------|--------|
| `src/main/claude/run-manager.ts` | Merge hot dirs with explicit dirs before spawn |
| `src/main/auto-attach.ts` | Add hash-based change detection |
| `src/main/git-context.ts` | Delegate to cache layer |

### Token Savings

| Scenario | Current | Optimized | Savings |
|---|---|---|---|
| New session, first prompt | ~8K tokens | ~4K tokens | 50% |
| Resumed session, 5th prompt | ~5K tokens | ~1K tokens | 80% |
| Rapid iteration (10 prompts) | ~50K total | ~14K total | 72% |

---

## System 4: Context Health Monitor (UI)

### Problem
Context exhaustion is invisible. Users don't know when a session is degrading until Claude starts behaving erratically.

### Solution: Non-Intrusive Per-Tab Health Indicator

#### Behavior by Threshold

| Utilization | Level | UI |
|---|---|---|
| < 50% | healthy | **Nothing visible** |
| 50-69% | warning | Small yellow dot on tab |
| 70-84% | danger | Orange warning icon + subtle banner |
| 85%+ | critical | Red pulsing icon + banner + "Start fresh with context" button |

#### Token Estimation

```typescript
function computeContextHealth(inputTokens, outputTokens, maxContextTokens, prev) {
  const estimated = inputTokens + outputTokens
  const percent = Math.min(100, Math.round((estimated / maxContextTokens) * 100))

  let level: ContextHealthLevel
  if (percent < 50) level = 'healthy'
  else if (percent < 70) level = 'warning'
  else if (percent < 85) level = 'danger'
  else level = 'critical'

  return { estimatedContextTokens: estimated, maxContextTokens, utilizationPercent: percent, level }
}
```

#### "Start Fresh with Context" Flow
1. Extract context from current tab (modified files, last task, memories)
2. Create new tab with smart context injection from current session
3. User seamlessly continues in clean session

#### Types Addition (`src/shared/types.ts`)

```typescript
type ContextHealthLevel = 'healthy' | 'warning' | 'danger' | 'critical'

interface ContextHealthState {
  estimatedContextTokens: number
  maxContextTokens: number
  utilizationPercent: number
  level: ContextHealthLevel
  warningSeen: boolean
  dangerSeen: boolean
}
```

### New Files
| File | Purpose |
|------|---------|
| `src/renderer/utils/context-health.ts` | computeContextHealth(), getMaxContextTokens() |
| `src/renderer/components/ContextHealthIndicator.tsx` | Tab dot/icon (Phosphor icons, Framer Motion) |
| `src/renderer/components/ContextHealthBanner.tsx` | Warning banner with action button |

### Modified Files
| File | Change |
|------|--------|
| `src/shared/types.ts` | Add ContextHealthLevel, ContextHealthState, IPC.START_FRESH_WITH_CONTEXT |
| `src/renderer/stores/sessionStore.ts` | Add contextHealth to tab state, update in handleNormalizedEvent |
| `src/main/claude/control-plane.ts` | Add startFreshWithContext() method, contextHealth init |
| `src/main/index.ts` | Add IPC handler for START_FRESH_WITH_CONTEXT |
| `src/preload/index.ts` | Expose startFreshWithContext() on window.clui |

---

## DB Migration: `002-token-optimization.ts`

```sql
-- Token accounting per run
CREATE TABLE session_token_stats (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  run_seq             INTEGER NOT NULL,
  input_tokens        INTEGER NOT NULL,
  output_tokens       INTEGER NOT NULL,
  cache_read_tokens   INTEGER DEFAULT 0,
  cache_create_tokens INTEGER DEFAULT 0,
  estimated_context   INTEGER,
  turn_count          INTEGER,
  recorded_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, run_seq)
);
CREATE INDEX idx_token_stats_session ON session_token_stats(session_id);

-- Pruning audit log
CREATE TABLE pruning_log (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id),
  action          TEXT NOT NULL,
  reason          TEXT NOT NULL,
  staleness_score REAL,
  tokens_before   INTEGER,
  tokens_saved    INTEGER,
  new_session_id  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pruning_session ON pruning_log(session_id);

-- Injection cache (avoid re-injecting unchanged context)
CREATE TABLE injection_cache (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id),
  cache_key    TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  token_count  INTEGER NOT NULL,
  injected_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, cache_key)
);
CREATE INDEX idx_injection_project ON injection_cache(project_id);

-- Cached directory scopes
CREATE TABLE scoped_dirs (
  project_hash TEXT NOT NULL,
  dir_path     TEXT NOT NULL,
  score        REAL NOT NULL,
  computed_at  INTEGER NOT NULL,
  PRIMARY KEY (project_hash, dir_path)
);

-- User scope overrides
CREATE TABLE scope_overrides (
  project_hash TEXT NOT NULL,
  dir_path     TEXT NOT NULL,
  action       TEXT NOT NULL CHECK(action IN ('pin', 'exclude')),
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (project_hash, dir_path)
);

-- Term co-occurrence for prompt matching
CREATE TABLE term_cooccurrence (
  term_a     TEXT NOT NULL,
  term_b     TEXT NOT NULL,
  weight     REAL NOT NULL DEFAULT 1.0,
  project_id TEXT NOT NULL REFERENCES projects(id),
  PRIMARY KEY (project_id, term_a, term_b)
);
CREATE INDEX idx_cooccurrence_lookup ON term_cooccurrence(project_id, term_a);

-- Performance index for hot file queries
CREATE INDEX IF NOT EXISTS idx_files_touched_project_time
  ON files_touched(project_id, created_at DESC);
```

---

## Implementation Roadmap

### Phase 1: Foundation (2-3 days)
**Token accounting + git caching — immediate wins, zero risk**

- [ ] DB migration `002-token-optimization.ts`
- [ ] Token stats recording in `ingestion-service.ts`
- [ ] Git context cache (`git-context-cache.ts`)
- [ ] Auto-attach change detection in `auto-attach.ts`

**Savings: ~5-10K tokens/day from cached git + skipped attachments**

### Phase 2: Context Health Monitor (2-3 days)
**Visibility layer — makes the problem visible**

- [ ] `ContextHealthState` types in `shared/types.ts`
- [ ] `context-health.ts` utility
- [ ] `ContextHealthIndicator.tsx` + `ContextHealthBanner.tsx`
- [ ] sessionStore integration
- [ ] IPC wiring for `START_FRESH_WITH_CONTEXT`

**Impact: Behavioral — users learn when to start fresh**

### Phase 3: Smart Context Injection (3-4 days)
**Enhanced memory packets — eliminates cold-start tax**

- [ ] Tiered packet architecture in `retrieval-service.ts`
- [ ] Relevance scoring with prompt matching
- [ ] Term co-occurrence builder in ingestion
- [ ] Increased token budget (2000 → 3000 tokens)

**Savings: 12-37K tokens/day**

### Phase 4: Context Pruning (3-4 days)
**Session forking — the biggest single optimization**

- [ ] `PruningOrchestrator` with staleness scoring
- [ ] `buildForkSummary()` heuristic summary generator
- [ ] Integration in `control-plane._dispatch()`
- [ ] Pruning audit log
- [ ] Injection cache to avoid redundant context

**Savings: 60-240K tokens/day**

### Phase 5: Adaptive Scoping (2-3 days)
**Directory scoping — reduces exploration tax**

- [ ] Hot file set SQL query
- [ ] Directory cover algorithm (`context-scoper.ts`)
- [ ] RunManager integration
- [ ] Scope cache (10-minute TTL)
- [ ] Override via command palette

**Savings: 5-15K tokens/day**

---

## Total Impact Summary

| Phase | System | Daily Token Savings | Complexity | Risk |
|---|---|---|---|---|
| 1 | Foundation | 5-10K | Low | Very Low |
| 2 | Health Monitor | Behavioral | Low | Very Low |
| 3 | Smart Injection | 12-37K | Medium | Low |
| 4 | Context Pruning | 60-240K | Medium | Medium |
| 5 | Adaptive Scoping | 5-15K | Medium | Low |
| **Total** | | **80-300K tokens/day** | | |

**For a power user spending ~1M tokens/day, this is a 8-30% reduction — fully automatic.**

---

## Key Design Constraints Respected

1. **No LLM calls for optimization** — all heuristic-based (SQLite queries + local computation)
2. **No new network calls** — app stays offline
3. **3-layer architecture preserved** — pruning in main process, health UI in renderer, IPC bridge
4. **IPC.* constants** for all new channels
5. **useColors()** for all health indicator colors
6. **Phosphor icons** for Warning/WarningOctagon
7. **Framer Motion** for indicator animations
8. **Permission server security** unchanged
9. **--resume continuity** — fork is the only way to shed context, never breaks existing sessions
10. **Graceful degradation** — if any optimization fails, falls back to current behavior
