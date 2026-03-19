# Context Database — Design Specification

**Date:** 2026-03-19
**Status:** Design complete (Sections 1-7, reviewed by tech-lead)

---

## 1. Database Layer

### Location
- `app.getPath('userData')/state/context.sqlite`
- `app.getPath('userData')/state/context.sqlite-wal`
- `app.getPath('userData')/state/blobs/` — payloads > 100KB

### Initialization
```sql
-- DatabaseService.init()
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

### IDs
UUID v7 (temporal + random). Better B-tree locality in SQLite than pure v4. Use lib like `uuidv7` or generate manually (timestamp prefix + random suffix).

### Soft Delete — Universal Rule
`deleted_at TEXT` on all tables where soft delete makes sense. No `is_deleted`. No mixing. Queries filter by `deleted_at IS NULL`. Partial indexes where needed for performance.

### Paths — Rule
- `files_touched.path` is relative to `projects.root_path` by convention. Absolute path only if file is outside project (rare, documented).
- `projects.root_path` is normalized before persisting: absolute resolved path, normalized separators, normalized casing on Windows.

### Blob Threshold
`events.payload_json` and `messages.content` with content > 100KB go to external file in `state/blobs/`. The table stores:
- `blob_path TEXT` — relative path to blobs directory
- `blob_hash TEXT` — SHA-256 of content
- Payload in column stays NULL or truncated (preview)

For V1, this is a documented rule with simple implementation: size check before insert, divert to blob if exceeds threshold.

### Schema V1

#### schema_migrations

```sql
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`DatabaseService.init()` reads `MAX(version)`, applies subsequent migrations in sequence within a transaction, inserts row per applied migration.

#### projects

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,  -- uuid v7
  name        TEXT NOT NULL,
  root_path   TEXT NOT NULL UNIQUE,  -- normalized: absolute, separators, casing
  repo_remote TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### sessions

Represents the logical CLUI session (1 tab = 1 session). `claude_session_id` references the underlying Claude CLI session when it exists. A session can have multiple runs (retries, continues) against the same `claude_session_id`.

```sql
CREATE TABLE sessions (
  id                TEXT PRIMARY KEY,  -- uuid v7
  claude_session_id TEXT,
  project_id        TEXT REFERENCES projects(id),
  title             TEXT,
  goal              TEXT,
  branch_name       TEXT,
  commit_sha_start  TEXT,
  commit_sha_end    TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  started_at        TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at          TEXT,
  pinned            INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT
);

CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_status ON sessions(status);
```

#### messages

```sql
CREATE TABLE messages (
  id               TEXT PRIMARY KEY,  -- uuid v7
  session_id       TEXT NOT NULL REFERENCES sessions(id),
  role             TEXT NOT NULL,
  content          TEXT,
  content_json     TEXT,
  blob_path        TEXT,       -- if content > 100KB
  blob_hash        TEXT,
  seq_num          INTEGER NOT NULL,
  token_count      INTEGER,
  importance_score REAL,       -- V2
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at       TEXT
);

CREATE INDEX idx_messages_session ON messages(session_id, seq_num);
```

#### events

```sql
CREATE TABLE events (
  id               TEXT PRIMARY KEY,  -- uuid v7
  session_id       TEXT NOT NULL REFERENCES sessions(id),
  event_type       TEXT NOT NULL,
  payload_json     TEXT,
  blob_path        TEXT,       -- if payload > 100KB
  blob_hash        TEXT,
  seq_num          INTEGER NOT NULL,
  importance_score REAL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at       TEXT
);

CREATE INDEX idx_events_session ON events(session_id, seq_num);
CREATE INDEX idx_events_type ON events(event_type);
```

#### files_touched

```sql
CREATE TABLE files_touched (
  id                  TEXT PRIMARY KEY,  -- uuid v7
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  event_id            TEXT REFERENCES events(id),
  path                TEXT NOT NULL,  -- relative to project.root_path
  action              TEXT NOT NULL,
  content_hash_before TEXT,
  content_hash_after  TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at          TEXT
);

CREATE INDEX idx_files_session ON files_touched(session_id);
CREATE INDEX idx_files_path ON files_touched(path);
```

#### artifacts

```sql
CREATE TABLE artifacts (
  id            TEXT PRIMARY KEY,  -- uuid v7
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  artifact_type TEXT NOT NULL,
  title         TEXT,
  body          TEXT,
  metadata_json TEXT,
  blob_path     TEXT,
  blob_hash     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE INDEX idx_artifacts_session ON artifacts(session_id);
```

#### memories

```sql
CREATE TABLE memories (
  id                   TEXT PRIMARY KEY,  -- uuid v7
  project_id           TEXT REFERENCES projects(id),
  session_id           TEXT REFERENCES sessions(id),
  memory_type          TEXT NOT NULL,
  scope                TEXT NOT NULL DEFAULT 'session',
  title                TEXT NOT NULL,
  body                 TEXT,
  source_refs_json     TEXT,
  importance_score     REAL DEFAULT 0.5,
  confidence_score     REAL DEFAULT 0.5,
  recency_score        REAL,
  access_count         INTEGER NOT NULL DEFAULT 0,
  last_accessed_at     TEXT,
  is_pinned            INTEGER NOT NULL DEFAULT 0,
  supersedes_memory_id TEXT REFERENCES memories(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at           TEXT
);

CREATE INDEX idx_memories_project ON memories(project_id);
CREATE INDEX idx_memories_type ON memories(memory_type);
CREATE INDEX idx_memories_scope ON memories(scope);
CREATE INDEX idx_memories_project_type ON memories(project_id, memory_type);
CREATE INDEX idx_memories_project_scope ON memories(project_id, scope);
CREATE INDEX idx_memories_active ON memories(project_id, updated_at)
  WHERE deleted_at IS NULL;
```

#### memory_fts

```sql
CREATE VIRTUAL TABLE memory_fts USING fts5(
  title,
  body,
  content='memories',
  content_rowid='rowid'
);
```

Policy: FTS is a text index only. Authority over visibility is the `memories` table. Search queries always JOIN with `memories WHERE deleted_at IS NULL`. Sync triggers maintain FTS on INSERT/UPDATE/DELETE, but soft delete filtering is applied in the query, not in the index.

#### entities + memory_entities (V2, created empty)

```sql
CREATE TABLE entities (
  id            TEXT PRIMARY KEY,  -- uuid v7
  name          TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  canonical_key TEXT UNIQUE
);

CREATE TABLE memory_entities (
  memory_id TEXT NOT NULL REFERENCES memories(id),
  entity_id TEXT NOT NULL REFERENCES entities(id),
  weight    REAL DEFAULT 1.0,
  PRIMARY KEY (memory_id, entity_id)
);
```

#### session_summaries

```sql
CREATE TABLE session_summaries (
  id           TEXT PRIMARY KEY,  -- uuid v7
  session_id   TEXT NOT NULL REFERENCES sessions(id),
  summary_kind TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT,
  UNIQUE(session_id, summary_kind)
);

CREATE INDEX idx_summaries_session ON session_summaries(session_id);
```

#### checkpoints (V2, created empty)

```sql
CREATE TABLE checkpoints (
  id              TEXT PRIMARY KEY,  -- uuid v7
  session_id      TEXT NOT NULL REFERENCES sessions(id),
  checkpoint_type TEXT NOT NULL,
  summary_body    TEXT,
  state_json      TEXT,
  event_seq_start INTEGER,
  event_seq_end   INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);

CREATE INDEX idx_checkpoints_session ON checkpoints(session_id);
```

### Foreign Keys — ON DELETE Policy
V1: Implicit RESTRICT (SQLite default when not specified). Physical deletes are rare and controlled. Future purge will have explicit deletion order (`memory_entities → entities, events → sessions → projects`) documented in DatabaseService.

---

## 2. Ingestion Pipeline (IngestionService)

### Responsibility
Listen to ControlPlane events in real-time, apply local heuristics, and persist structural data to the DB via DatabaseService. No LLM. No semantic interpretation. Only mechanical capture of what happened.

### Position in Architecture
```
ControlPlane ──emits 'event'──→ IngestionService ──writes──→ DatabaseService
│                                │
└──emits 'tab-status-change'─────┘
```

### Integration Point
```typescript
controlPlane.on('event', (tabId, event: NormalizedEvent) => {
  ingestionService.ingest(tabId, event)
})

controlPlane.on('tab-status-change', (tabId, newStatus, oldStatus) => {
  ingestionService.onTabStatusChange(tabId, newStatus, oldStatus)
})
```

Same pattern as existing `src/main/index.ts` IPC broadcast — IngestionService is one more listener, does not intercept or modify the existing flow.

### User Prompt Capture
User prompts don't come from the stream — they come from `ControlPlane.prompt()`. Captured before sending to RunManager:

```typescript
// Called before sending to RunManager
ingestionService.ingestUserMessage(tabId, requestId, prompt, attachments)
```

Creates a message with `role: 'user'`, correct `seq_num`, and attachment references.

### Event → Table Mapping

| NormalizedEvent type | Table(s) affected | Data extracted |
|---|---|---|
| `session_init` | sessions | Create/update session with claude_session_id, model, tools, version. Create project if not exists (from tab's workingDirectory). |
| `text_chunk` | events | Raw event. Accumulated in buffer to build complete messages. Not persisted individually. |
| `tool_call` | events, files_touched | Event with toolName, toolId. If tool is Edit/Write/Read → extract path, register in files_touched. |
| `tool_call_update` | internal buffer | Accumulates partialInput for current tool call. Not persisted incrementally. |
| `tool_call_complete` | events, files_touched | Persists complete tool call. Updates files_touched with final action. |
| `task_update` | messages | Persists complete assistant message (AssistantMessagePayload → message with content_json). |
| `task_complete` | sessions, events, session_summaries | Updates session status→completed, ended_at, commit_sha_end. Registers cost/tokens as event. Generates mechanical summary (V1). |
| `error` | events | Registers error with message and sessionId. |
| `session_dead` | sessions, events | Updates session status→dead. Registers exitCode, signal, stderrTail. |
| `permission_request` | events | Registers permission request with toolName and options. |
| `rate_limit` | events | Registers rate limit with type and reset time. |
| `usage` | events | Registers token usage snapshot. |

### Text Chunk Buffering
`text_chunk` events arrive at high frequency during streaming. Strategy:
- Accumulate chunks in memory buffer per tabId
- Flush to messages (role: assistant) when:
  - `task_update` arrives (complete message)
  - `tool_call` arrives (start of tool use, flush previous text)
  - `task_complete` arrives (end of session)
  - 5s timeout without new chunks (session paused)
- If app crashes before flush, buffer is lost — acceptable for V1 because Claude CLI maintains session in `~/.claude/sessions/`

### files_touched Extraction

| toolName | action |
|---|---|
| Read | read |
| Edit | patch |
| Write | write |
| MultiEdit | patch |
| Bash (with rm, del) | delete (best-effort, command parse) |

Path extracted from toolInput (`file_path` or `path`), normalized to relative to `project.root_path`.

`content_hash_before/after` — V1: not calculated (would require file reads). Columns exist for V2.

### Session Lifecycle

```
Tab created     → IngestionService.onTabCreated(tabId, workingDirectory)
                  → Create/resolve project
                  → Create session (status: active)

session_init    → Update session with claude_session_id, model

[events]        → Continuous ingestion

task_complete   → Update session (status: completed, ended_at, costs)
                → Generate session_summary mechanical (V1)

session_dead    → Update session (status: dead)
                → Flush pending buffers

Tab closed      → IngestionService.onTabClosed(tabId)
                → Final flush
                → If session stayed active without task_complete → status: abandoned
```

### Mechanical Session Summary (V1)

On `task_complete`, automatically generates a `session_summary` with `summary_kind: 'technical'`:

```
Goal: ${session.goal || session.title || 'N/A'}
Files touched: ${filesTouched.map(f => `${f.action} ${f.path}`).join(', ')}
Tools used: ${uniqueToolNames.join(', ')}
Errors: ${errorCount}
Cost: $${costUsd}
Duration: ${durationMs}ms
Status: ${session.status}
```

Not semantic — factual. Useful for retrieval and UI. V2 will add model-generated summaries.

### Batch & Transactions
- Multiple events within same transaction when possible (e.g., `task_complete` updates session + creates events + generates summary in one transaction)
- High-frequency individual events (`text_chunk`) are buffered, not individually transacted
- `files_touched` inserted in batch at end of each complete tool call

### Error Handling
- Ingestion failure never blocks main flow. ControlPlane continues even if DB has problems.
- Ingestion errors logged via existing logger
- If DB is inaccessible (corrupt, locked), IngestionService enters degraded mode: logs warnings, doesn't try to write, recovers automatically when DB returns

### V2 Preparation
The IngestionService maintains an event counter per session (`eventSeqCounter`). This allows V2 to add:
- Semantic extraction trigger every N events
- Checkpoints with `event_seq_start/event_seq_end` referencing exact ranges
- Boundary detection (toolName pattern change, edit burst, error followed by fix)

```typescript
// V2 - not implemented in V1, but structure supports it
ingestionService.on('checkpoint-ready', (sessionId, seqRange) => {
  extractionService.extractFromRange(sessionId, seqRange)
})
```

---

## Open Questions — Resolved

### 1. onTabCreated
IngestionService does NOT use `onTabCreated`. Session record is created lazily on first `session_init` event, which carries `cwd` via the underlying `InitEvent`. This eliminates the need for a tab creation hook entirely.

### 2. MultiEdit
Confirmed real toolName in CLI stream. Evidence: `run-manager.ts` line 54 (`DEFAULT_ALLOWED_TOOLS`), `permission-server.ts` line 38 (`PERMISSION_REQUIRED_TOOLS`).

### 3. Session resume
A resumed CLI session maps to a NEW database session row. The Clui "session" represents a tab lifecycle, not the underlying CLI session. `sessions.claude_session_id` is NOT unique — multiple rows can share the same value. Queries for "all work in CLI session X" use `GROUP BY claude_session_id`.

---

## 3. Retrieval & Memory Packet

### 3.1 Problem Statement
When the user sends a prompt, the system composes a "memory packet" — relevant context from the database prepended to Claude's system prompt via `systemPrompt` in `RunOptions`. Must be token-budget-aware and add no measurable latency.

### 3.2 Retrieval Architecture

```
ControlPlane._dispatch()
  → RetrievalService.buildMemoryPacket(projectId, tabId, prompt, budget)
  → Returns: string (formatted context block) or null
  → Injected into options.systemPrompt before RunManager.startRun()
```

RetrievalService is **synchronous** (better-sqlite3 prepared statements). No async, no event loop yielding. Critical because `_dispatch` is already async.

### 3.3 Memory Packet Structure

```xml
<clui_context>
<project name="my-app" path="/Users/x/projects/my-app">
Last active: 2026-03-18
Sessions: 14 | Files touched: 47 unique paths
</project>

<recent_sessions max="3">
<session id="abc123" date="2026-03-18" status="completed" duration="45s" cost="$0.12">
Goal: Fix authentication middleware
Files: src/auth/middleware.ts (patch), src/auth/types.ts (write)
Tools: Edit, Bash, Read
Summary: Fixed JWT validation bug in middleware, added refresh token support.
</session>
</recent_sessions>

<relevant_memories count="5">
<memory type="decision" importance="0.9" created="2026-03-17">
Architecture decision: Using Zod for runtime validation instead of io-ts.
</memory>
</relevant_memories>

<active_files count="3">
src/auth/middleware.ts — patched 3 times across 2 sessions
src/api/routes.ts — read 12 times, patched 2 times
</active_files>
</clui_context>
```

XML-like tags: Claude handles them well, unambiguous, compress well. Rejected: JSON (wastes tokens), Markdown (ambiguous nesting), YAML (indentation sensitivity).

### 3.4 Token Budget

```typescript
interface MemoryPacketConfig {
  maxTokens: number           // Default: 2000
  maxRecentSessions: number   // Default: 3
  maxMemories: number         // Default: 8
  maxActiveFiles: number      // Default: 10
  minImportanceScore: number  // Default: 0.3
}
```

Token estimation V1: `character count / 4`. Deliberately imprecise — a proper tokenizer adds dependency and latency for minimal gain at these budget sizes. Soft limit — 10% over is acceptable.

**Priority-based truncation** (if total exceeds maxTokens, trim in order):
1. `active_files` (least critical)
2. `relevant_memories` (reduce count from bottom, lowest scoring)
3. `recent_sessions` (reduce count, oldest first)
4. `project` header (never trimmed)

### 3.5 Retrieval Queries

**Recent sessions:**
```sql
SELECT s.id, s.title, s.goal, s.status, s.started_at, s.ended_at,
       ss.body as summary
FROM sessions s
LEFT JOIN session_summaries ss ON ss.session_id = s.id AND ss.summary_kind = 'technical'
WHERE s.project_id = ? AND s.deleted_at IS NULL AND s.status IN ('completed', 'dead')
ORDER BY s.ended_at DESC LIMIT ?
```

**Relevant memories (FTS + importance):**
```sql
SELECT m.*, 1.0 / (1.0 + (julianday('now') - julianday(COALESCE(m.last_accessed_at, m.created_at))) * 0.1) as recency_score
FROM memories m
JOIN memory_fts ON memory_fts.rowid = m.rowid
WHERE m.project_id = ? AND m.deleted_at IS NULL AND m.importance_score >= ?
  AND memory_fts MATCH ?
ORDER BY rank * m.importance_score DESC LIMIT ?
```

**Fallback (no prompt text):**
```sql
SELECT m.* FROM memories m
WHERE m.project_id = ? AND m.deleted_at IS NULL AND m.importance_score >= ?
ORDER BY m.importance_score DESC, m.updated_at DESC LIMIT ?
```

**Active files:**
```sql
SELECT ft.path, ft.action, COUNT(*) as touch_count, MAX(ft.created_at) as last_touched
FROM files_touched ft JOIN sessions s ON ft.session_id = s.id
WHERE s.project_id = ? AND ft.deleted_at IS NULL
GROUP BY ft.path ORDER BY touch_count DESC, last_touched DESC LIMIT ?
```

### 3.6 Memory Access Tracking

When memory is included in a packet:
```sql
UPDATE memories SET access_count = access_count + 1,
  last_accessed_at = datetime('now') WHERE id IN (?, ?, ...)
```

Batched, single statement, same synchronous call.

### 3.7 Integration Point

Mirrors the existing `agentMemory.buildPromptContext()` pattern at `control-plane.ts` lines 688-696. ControlPlane gets a `setRetrievalService()` method (like `setAgentMemory()`).

### 3.8 RetrievalService Interface

```typescript
interface RetrievalService {
  resolveProjectId(projectPath: string): string | null
  buildMemoryPacket(projectId: string, tabId: string, prompt: string, config: MemoryPacketConfig): string | null
  searchMemories(projectId: string, query: string, limit: number): MemorySearchResult[]
}
```

---

## 4. Memory Lifecycle

### 4.1 Memory Types (V1 — Mechanical Only)

| memory_type | scope | Trigger | Example |
|---|---|---|---|
| `session_outcome` | project | `task_complete` | "Fixed auth middleware, 3 files, 45s, $0.12" |
| `file_pattern` | project | file touch frequency >= 5 across >= 2 sessions | "middleware.ts heavily edited" |
| `error_pattern` | project | same error >= 3 times | "Permission denied on npm install" |
| `tool_preference` | project | session complete (recalculate) | "Edit 45%, Bash 30%, Read 25%" |

Rejected for V1: `decision`, `convention`, `architecture` — require LLM. Including them would produce low-quality noise.

### 4.2 Importance Scoring (V1 — Deterministic)

```typescript
function computeSessionImportance(session): number {
  let score = 0.5
  if (session.status === 'completed') score += 0.1
  if (session.status === 'dead') score -= 0.1
  if (session.filesTouched.length >= 5) score += 0.15
  else if (session.filesTouched.length >= 2) score += 0.05
  if (session.errorCount > 0 && session.status === 'completed') score += 0.1
  if (session.durationMs > 120_000) score += 0.05
  return Math.max(0.0, Math.min(1.0, score))
}
```

V1 confidence: always 1.0 (mechanical = factual). V2 LLM memories will use lower confidence.

### 4.3 Recency Score

Computed at query time, not stored:
```sql
1.0 / (1.0 + (julianday('now') - julianday(COALESCE(last_accessed_at, created_at))) * 0.1)
-- 0 days = 1.0, 7 days = 0.59, 30 days = 0.25, 90 days = 0.10
```

### 4.4 Memory Supersession

New memory replaces old: `supersedes_memory_id` → old, soft-delete old. Single transaction.

### 4.5 Pruning (V1 — Conservative)

```sql
UPDATE memories SET deleted_at = datetime('now')
WHERE deleted_at IS NULL AND is_pinned = 0
  AND importance_score < 0.2
  AND COALESCE(last_accessed_at, created_at) < datetime('now', '-90 days')
```

Trigger: app startup + daily setInterval. Hard delete: never in V1.

### 4.6 Pinning

Pinned memories: never pruned, always in memory packet (budget permitting), sorted first.

---

## 5. IPC & Renderer Integration

### 5.1 New IPC Constants

```typescript
// Context Database (renderer → main)
CONTEXT_SEARCH_MEMORIES: 'clui:context-search-memories',
CONTEXT_GET_SESSION_HISTORY: 'clui:context-get-session-history',
CONTEXT_GET_SESSION_DETAIL: 'clui:context-get-session-detail',
CONTEXT_GET_PROJECT_STATS: 'clui:context-get-project-stats',
CONTEXT_PIN_MEMORY: 'clui:context-pin-memory',
CONTEXT_UNPIN_MEMORY: 'clui:context-unpin-memory',
CONTEXT_DELETE_MEMORY: 'clui:context-delete-memory',
CONTEXT_GET_FILES_TOUCHED: 'clui:context-get-files-touched',
CONTEXT_GET_MEMORY_PACKET_PREVIEW: 'clui:context-get-memory-packet-preview',

// Context Database (main → renderer, broadcast)
CONTEXT_MEMORY_CREATED: 'clui:context-memory-created',
CONTEXT_SESSION_RECORDED: 'clui:context-session-recorded',
```

### 5.2 Payload Types

```typescript
interface ContextSessionSummary {
  id: string; title: string | null; goal: string | null; status: string
  startedAt: string; endedAt: string | null; filesTouchedCount: number
  toolsUsed: string[]; costUsd: number | null; durationMs: number | null
  summary: string | null
}

interface ContextMemory {
  id: string; memoryType: string; scope: string; title: string
  body: string | null; importanceScore: number; confidenceScore: number
  isPinned: boolean; accessCount: number; createdAt: string; updatedAt: string
}

interface ContextProjectStats {
  projectId: string; projectName: string; sessionCount: number
  totalCostUsd: number; uniqueFilesTouched: number; memoryCount: number
  lastActiveAt: string | null
}

interface ContextFileTouched {
  path: string; totalTouches: number; actions: string[]
  lastTouched: string; sessionCount: number
}
```

### 5.3 Zustand Store: contextStore.ts

Standalone store (not merged into sessionStore — context concerns are orthogonal).

```typescript
interface ContextState {
  memories: ContextMemory[]
  sessionHistory: ContextSessionSummary[]
  projectStats: ContextProjectStats | null
  filesTouched: ContextFileTouched[]
  memoryPacketPreview: string | null
  searchQuery: string
  isLoading: boolean
  panelOpen: boolean
  activeSection: 'memories' | 'sessions' | 'files' | 'preview'

  openPanel: () => void
  closePanel: () => void
  setActiveSection: (section: ContextState['activeSection']) => void
  loadMemories: (projectPath: string, query?: string) => Promise<void>
  loadSessionHistory: (projectPath: string) => Promise<void>
  pinMemory: (memoryId: string) => Promise<void>
  unpinMemory: (memoryId: string) => Promise<void>
  deleteMemory: (memoryId: string) => Promise<void>
  handleMemoryCreated: (memory: ContextMemory) => void
  handleSessionRecorded: (session: ContextSessionSummary) => void
}
```

### 5.4 V1 UI — Minimal

1. **Context Panel** (toggleable via command palette): memories, session history, file activity
2. **Memory Packet Preview**: what would be injected into next prompt
3. **Toast on memory creation**: "Memory recorded: [title]"

---

## 6. Migration & Initialization

### 6.1 DatabaseService.init() Flow

```
app.whenReady()
  → new DatabaseService(dbPath)
  → DatabaseService.init()
    → Ensure directory exists
    → Open SQLite (better-sqlite3)
    → Set PRAGMAs (WAL, foreign_keys, busy_timeout)
    → Apply pending migrations
  → new IngestionService(databaseService, controlPlane)
  → new RetrievalService(databaseService)
  → Wire to ControlPlane events
```

### 6.2 Migration System

One transaction per migration (not all-in-one). If migration 3 of 5 fails, 1-2 are preserved.

```typescript
interface Migration {
  version: number; name: string; up: (db: Database) => void
}
```

### 6.3 Database Corruption Recovery

Rename corrupt file → `context.sqlite.corrupt.{timestamp}`, create fresh. Context data is derived (CLI sessions still exist in `~/.claude/sessions/`), so no user work is lost.

### 6.4 FTS Sync Triggers

```sql
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memory_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO memory_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
```

### 6.5 DatabaseService Interface

```typescript
interface DatabaseService {
  readonly db: Database
  init(): void
  upsertProject(rootPath: string, name: string, repoRemote?: string): string
  getProjectByPath(rootPath: string): ProjectRow | null
  createSession(projectId: string, claudeSessionId?: string): string
  updateSession(id: string, fields: Partial<SessionUpdate>): void
  getSessionHistory(projectPath: string, limit: number, offset: number): ContextSessionSummary[]
  insertMessage(sessionId: string, role: string, content: string, seqNum: number): string
  insertEvent(sessionId: string, eventType: string, payloadJson: string, seqNum: number): string
  insertFileTouched(sessionId: string, eventId: string | null, path: string, action: string): string
  insertMemory(memory: MemoryInsert): string
  supersedeMemory(oldId: string, newMemory: MemoryInsert): void
  pinMemory(id: string): void
  unpinMemory(id: string): void
  deleteMemory(id: string): void
  upsertSessionSummary(sessionId: string, kind: string, body: string): void
  pruneStaleMemories(): number
  close(): void
}
```

---

## 7. Implementation Plan

### 7.1 File Structure

```
src/main/context/
  database-service.ts      — SQLite connection, migrations, CRUD
  ingestion-service.ts     — Event listener, extraction, memory creation
  retrieval-service.ts     — Memory packet assembly, FTS queries
  migrations/
    001-initial-schema.ts  — All V1 tables, indexes, triggers
  types.ts                 — Internal types
  blob-store.ts            — Write/read blobs > 100KB
  id.ts                    — UUID v7 generation

src/renderer/stores/
  contextStore.ts          — Zustand store for context panel
```

### 7.2 Implementation Order

**Phase 1: Foundation** — `id.ts`, `blob-store.ts`, `001-initial-schema.ts`, `database-service.ts`, `types.ts`
Checkpoint: `npm run build` passes. DB initializes and creates schema.

**Phase 2: Ingestion** — `ingestion-service.ts`, wire into `index.ts`, connect to ControlPlane events
Checkpoint: Send prompts, verify data in SQLite.

**Phase 3: Retrieval** — `retrieval-service.ts`, inject memory packet into ControlPlane dispatch, `session_outcome` memory creation
Checkpoint: Memory packet appears in Claude's context.

**Phase 4: IPC & UI** — IPC constants, handlers, preload bridge, `contextStore.ts`, broadcast listeners
Checkpoint: Context panel shows data.

**Phase 5: Memory lifecycle** — file_pattern, error_pattern, tool_preference extractors, pruning, supersession, pinning

### 7.3 Dependencies

`better-sqlite3` — only new npm dependency. Verify Electron rebuild handles it (check if `node-pty` already requires native module support).

UUID v7: ~15 lines utility, no library needed.

### 7.4 Self-Review — Known Gaps

1. **First prompt has no FTS context** — memory packet for first prompt uses only project-level data
2. **Token estimation is rough** — char/4 can be off 30-50% for code. Soft limit, acceptable for V1
3. **No backpressure on ingestion** — buffer can grow unbounded. Add 1MB cap per tab
4. **FTS not ideal for code tokens** — `src/auth/` won't match well. V2: custom tokenizer
5. **WAL on Windows** — anti-virus/cloud sync can interfere. userData path should be safe
6. **Blob storage unbounded** — no GC for soft-deleted refs. V2 needs blob GC
