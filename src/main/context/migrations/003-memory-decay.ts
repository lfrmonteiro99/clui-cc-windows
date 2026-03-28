import type { Migration } from '../types'

/**
 * Migration 003 — Memory decay support.
 *
 * The `last_accessed_at` column already exists from migration 001, but
 * may contain NULL values for memories that were never accessed. This
 * migration backfills those NULLs with `created_at` so that age-based
 * pruning and decay scoring have a consistent baseline.
 *
 * Also adds an index to support efficient pruning queries that filter
 * on `last_accessed_at` and `importance_score`.
 */
export const migration: Migration = {
  version: 3,
  name: 'memory_decay',
  up: (db: any) => {
    // Backfill last_accessed_at for memories that have never been accessed
    db.exec(`
      UPDATE memories SET last_accessed_at = created_at
      WHERE last_accessed_at IS NULL;
    `)

    // Index to speed up pruning queries (not pinned, low importance, old access)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_pruning
        ON memories(is_pinned, importance_score, last_accessed_at)
        WHERE deleted_at IS NULL;
    `)
  },
}
