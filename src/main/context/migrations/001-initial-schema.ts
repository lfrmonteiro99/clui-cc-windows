/**
 * Migration 001 — Initial schema for the context database.
 *
 * Creates all V1 tables, indexes, FTS virtual table, and sync triggers
 * as specified in docs/superpowers/specs/2026-03-19-context-database-design.md Section 1.
 *
 * V2-only tables (entities, memory_entities, checkpoints) are created empty
 * with their full schema so the shape is locked in from day one.
 */

export interface Migration {
  version: number
  name: string
  up: (db: any) => void // better-sqlite3 Database type
}

export const migration: Migration = {
  version: 1,
  name: 'initial_schema',
  up: (db) => {
    // ── projects ──────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        root_path   TEXT NOT NULL UNIQUE,
        repo_remote TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)

    // ── sessions ──────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE sessions (
        id                TEXT PRIMARY KEY,
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
    `)

    // ── messages ──────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE messages (
        id               TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL REFERENCES sessions(id),
        role             TEXT NOT NULL,
        content          TEXT,
        content_json     TEXT,
        blob_path        TEXT,
        blob_hash        TEXT,
        seq_num          INTEGER NOT NULL,
        token_count      INTEGER,
        importance_score REAL,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at       TEXT
      );

      CREATE INDEX idx_messages_session ON messages(session_id, seq_num);
    `)

    // ── events ────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE events (
        id               TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL REFERENCES sessions(id),
        event_type       TEXT NOT NULL,
        payload_json     TEXT,
        blob_path        TEXT,
        blob_hash        TEXT,
        seq_num          INTEGER NOT NULL,
        importance_score REAL,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at       TEXT
      );

      CREATE INDEX idx_events_session ON events(session_id, seq_num);
      CREATE INDEX idx_events_type ON events(event_type);
    `)

    // ── files_touched ─────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE files_touched (
        id                  TEXT PRIMARY KEY,
        session_id          TEXT NOT NULL REFERENCES sessions(id),
        event_id            TEXT REFERENCES events(id),
        path                TEXT NOT NULL,
        action              TEXT NOT NULL,
        content_hash_before TEXT,
        content_hash_after  TEXT,
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at          TEXT
      );

      CREATE INDEX idx_files_session ON files_touched(session_id);
      CREATE INDEX idx_files_path ON files_touched(path);
    `)

    // ── artifacts ─────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE artifacts (
        id            TEXT PRIMARY KEY,
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
    `)

    // ── memories ──────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE memories (
        id                   TEXT PRIMARY KEY,
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
    `)

    // ── memory_fts (FTS5 virtual table) ───────────────────────────────
    db.exec(`
      CREATE VIRTUAL TABLE memory_fts USING fts5(
        title,
        body,
        content='memories',
        content_rowid='rowid'
      );
    `)

    // ── FTS sync triggers ─────────────────────────────────────────────
    db.exec(`
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
    `)

    // ── entities (V2, created empty) ──────────────────────────────────
    db.exec(`
      CREATE TABLE entities (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        entity_type   TEXT NOT NULL,
        canonical_key TEXT UNIQUE
      );
    `)

    // ── memory_entities (V2, created empty) ───────────────────────────
    db.exec(`
      CREATE TABLE memory_entities (
        memory_id TEXT NOT NULL REFERENCES memories(id),
        entity_id TEXT NOT NULL REFERENCES entities(id),
        weight    REAL DEFAULT 1.0,
        PRIMARY KEY (memory_id, entity_id)
      );
    `)

    // ── session_summaries ─────────────────────────────────────────────
    db.exec(`
      CREATE TABLE session_summaries (
        id           TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL REFERENCES sessions(id),
        summary_kind TEXT NOT NULL,
        body         TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at   TEXT,
        UNIQUE(session_id, summary_kind)
      );

      CREATE INDEX idx_summaries_session ON session_summaries(session_id);
    `)

    // ── checkpoints (V2, created empty) ───────────────────────────────
    db.exec(`
      CREATE TABLE checkpoints (
        id              TEXT PRIMARY KEY,
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
    `)
  },
}
