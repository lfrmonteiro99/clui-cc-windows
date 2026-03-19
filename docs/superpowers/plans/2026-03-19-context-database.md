# Context Database — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Add persistent context database (SQLite) that captures session events, builds mechanical memories, and injects relevant context into Claude's prompts.

**Architecture:** DatabaseService (better-sqlite3) → IngestionService (ControlPlane listener) → RetrievalService (memory packet assembly). Main process only. Renderer accesses via IPC.

**Tech Stack:** TypeScript, better-sqlite3, SQLite WAL, UUID v7, FTS5

**Spec:** `docs/superpowers/specs/2026-03-19-context-database-design.md`

---

## Dependency Graph

```
Phase 1 (Foundation):
  CTX-001 (id.ts) ──────┐
  CTX-002 (blob-store) ──┼──→ CTX-004 (DatabaseService)
  CTX-003 (migration) ───┘

Phase 2 (Ingestion):
  CTX-004 ──→ CTX-005 (IngestionService) ──→ CTX-006 (wire into index.ts)

Phase 3 (Retrieval):
  CTX-004 ──→ CTX-007 (RetrievalService) ──→ CTX-008 (wire into ControlPlane)

Phase 4 (IPC & UI):
  CTX-006 + CTX-007 ──→ CTX-009 (IPC channels) ──→ CTX-010 (contextStore) ──→ CTX-011 (ContextPanel)

Phase 5 (Lifecycle):
  CTX-005 ──→ CTX-012 (memory extractors)
  CTX-004 + CTX-009 ──→ CTX-013 (pruning + pinning)
```

---

## Phase 1: Foundation

### CTX-001: UUID v7 generator (#130)
- Create `src/main/context/id.ts`
- `generateId(): string` — timestamp prefix + random suffix
- Tests: uniqueness, sortability, format

### CTX-002: Blob store (#131)
- Create `src/main/context/blob-store.ts`
- `writeBlob(content)`, `readBlob(blobPath)`, `shouldUseBlob(content)`
- SHA-256 hash, auto-creates directory

### CTX-003: Initial schema migration (#132)
- Create `src/main/context/migrations/001-initial-schema.ts`
- All 12 tables, indexes, FTS5 virtual table, sync triggers
- V2 tables created empty

### CTX-004: DatabaseService (#133)
- Create `src/main/context/database-service.ts` + `types.ts`
- Init, PRAGMAs, migration runner, corruption recovery
- Full CRUD interface per spec Section 6.5
- Install `better-sqlite3`
- **Depends on:** CTX-001, CTX-002, CTX-003

**Phase 1 Checkpoint:** `npm run build` passes. DB initializes and creates schema. No integration.

---

## Phase 2: Ingestion

### CTX-005: IngestionService (#134)
- Create `src/main/context/ingestion-service.ts`
- ControlPlane event handlers per mapping table (Section 2)
- Text chunk buffering (5s flush timeout)
- files_touched extraction by toolName
- Session lifecycle: active → completed/dead/abandoned
- Mechanical session summary on task_complete
- Error isolation (never blocks ControlPlane)
- **Depends on:** CTX-004

### CTX-006: Wire into main process (#135)
- Modify `src/main/index.ts`
- Instantiate services, connect events, hook user prompt capture
- Graceful shutdown
- **Depends on:** CTX-004, CTX-005

**Phase 2 Checkpoint:** Send prompts, verify data appears in SQLite. No retrieval, no UI.

---

## Phase 3: Retrieval

### CTX-007: RetrievalService (#136)
- Create `src/main/context/retrieval-service.ts`
- `buildMemoryPacket()` — XML-tagged context block
- Token budget (char/4, 2000 default, priority truncation)
- FTS + importance queries
- Memory access tracking
- **Depends on:** CTX-004

### CTX-008: Wire into ControlPlane (#137)
- Add `setRetrievalService()` to ControlPlane (like `setAgentMemory()`)
- Inject memory packet in `_dispatch()` before RunManager
- **Depends on:** CTX-007

**Phase 3 Checkpoint:** Memory packet appears in Claude's context. Ask Claude "what context do you have about this project?" to verify.

---

## Phase 4: IPC & UI

### CTX-009: IPC channels + preload (#138)
- 11 IPC constants in types.ts
- Payload types: ContextSessionSummary, ContextMemory, ContextProjectStats, ContextFileTouched
- 9 handlers + 2 broadcast channels
- Preload bridge methods
- **Depends on:** CTX-006, CTX-007

### CTX-010: Zustand store + listeners (#139)
- Create `src/renderer/stores/contextStore.ts`
- Broadcast listeners for memory-created / session-recorded
- Toast on memory creation
- **Depends on:** CTX-009

### CTX-011: Context panel UI (#140)
- Create `src/renderer/components/ContextPanel.tsx`
- 4 tabs: Memories, Sessions, Files, Packet Preview
- Search, pin/unpin/delete, pagination
- Command palette entry
- **Depends on:** CTX-010

**Phase 4 Checkpoint:** Context panel shows live data. Memory packet preview works.

---

## Phase 5: Memory Lifecycle

### CTX-012: Memory extractors (#141)
- file_pattern, error_pattern, tool_preference extractors
- Importance scoring formulas
- Deduplication via supersession
- **Depends on:** CTX-005

### CTX-013: Pruning + pinning (#142)
- Auto-prune: importance < 0.2 + 90 days stale + not pinned
- Trigger: startup + daily interval
- Pinned protection end-to-end
- **Depends on:** CTX-004, CTX-009

**Phase 5 Checkpoint:** Memories accumulate, low-value ones decay, pinned persist.

---

## Not in V1
- Entity extraction (entities, memory_entities)
- Checkpoints
- LLM-generated summaries/memories
- Semantic similarity (embeddings)
- Cross-project memory sharing
- Database compaction / hard delete
- Blob GC
