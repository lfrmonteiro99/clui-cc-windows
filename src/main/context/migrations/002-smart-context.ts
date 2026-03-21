import type { Migration } from '../types'

export const migration: Migration = {
  version: 2,
  name: 'smart_context',
  up: (db: any) => {
    // ── decisions table ──────────────────────────────────────────────
    db.exec(`
      CREATE TABLE decisions (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL REFERENCES projects(id),
        session_id      TEXT NOT NULL REFERENCES sessions(id),
        title           TEXT NOT NULL,
        body            TEXT NOT NULL,
        category        TEXT NOT NULL DEFAULT 'general',
        importance_score REAL NOT NULL DEFAULT 0.5,
        supersedes_id   TEXT REFERENCES decisions(id),
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at      TEXT
      );
      CREATE INDEX idx_decisions_project ON decisions(project_id, importance_score DESC);
      CREATE INDEX idx_decisions_category ON decisions(project_id, category);
    `)

    // ── pitfalls table ───────────────────────────────────────────────
    db.exec(`
      CREATE TABLE pitfalls (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL REFERENCES projects(id),
        session_id      TEXT NOT NULL REFERENCES sessions(id),
        title           TEXT NOT NULL,
        body            TEXT NOT NULL,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        importance_score REAL NOT NULL DEFAULT 0.5,
        last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
        resolved        INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at      TEXT
      );
      CREATE INDEX idx_pitfalls_project ON pitfalls(project_id)
        WHERE deleted_at IS NULL AND resolved = 0;
    `)

    // ── user_patterns table ──────────────────────────────────────────
    db.exec(`
      CREATE TABLE user_patterns (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL REFERENCES projects(id),
        pattern_type    TEXT NOT NULL,
        title           TEXT NOT NULL,
        body            TEXT,
        confidence_score REAL NOT NULL DEFAULT 0.5,
        observation_count INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at      TEXT
      );
      CREATE INDEX idx_patterns_project ON user_patterns(project_id)
        WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX idx_patterns_unique ON user_patterns(project_id, pattern_type, title)
        WHERE deleted_at IS NULL;
    `)

    // ── term_cooccurrences table ─────────────────────────────────────
    db.exec(`
      CREATE TABLE term_cooccurrences (
        term_a    TEXT NOT NULL,
        term_b    TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        weight    REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY (project_id, term_a, term_b)
      );
      CREATE INDEX idx_cooccur_lookup ON term_cooccurrences(project_id, term_a);
    `)

    // ── FTS for decisions ────────────────────────────────────────────
    db.exec(`
      CREATE VIRTUAL TABLE decisions_fts USING fts5(
        title, body,
        content='decisions', content_rowid='rowid'
      );

      CREATE TRIGGER decisions_ai AFTER INSERT ON decisions BEGIN
        INSERT INTO decisions_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;
      CREATE TRIGGER decisions_ad AFTER DELETE ON decisions BEGIN
        INSERT INTO decisions_fts(decisions_fts, rowid, title, body)
          VALUES ('delete', old.rowid, old.title, old.body);
      END;
      CREATE TRIGGER decisions_au AFTER UPDATE ON decisions BEGIN
        INSERT INTO decisions_fts(decisions_fts, rowid, title, body)
          VALUES ('delete', old.rowid, old.title, old.body);
        INSERT INTO decisions_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;
    `)

    // ── Additional index on sessions for continuation detection ──────
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(project_id, started_at DESC)
        WHERE deleted_at IS NULL;
    `)
  },
}
