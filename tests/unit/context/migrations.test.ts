import { describe, it, expect } from 'vitest'
import { migration } from '../../../src/main/context/migrations/001-initial-schema'

describe('001-initial-schema migration', () => {
  it('has correct version and name', () => {
    expect(migration.version).toBe(1)
    expect(migration.name).toBe('initial_schema')
  })

  it('has an up function', () => {
    expect(typeof migration.up).toBe('function')
  })

  it('calls db.exec for each table group', () => {
    const execCalls: string[] = []
    const fakeDb = {
      exec: (sql: string) => {
        execCalls.push(sql)
      },
    }

    migration.up(fakeDb)

    // Verify all tables are created
    const allSql = execCalls.join('\n')
    const expectedTables = [
      'projects',
      'sessions',
      'messages',
      'events',
      'files_touched',
      'artifacts',
      'memories',
      'entities',
      'memory_entities',
      'session_summaries',
      'checkpoints',
    ]
    for (const table of expectedTables) {
      expect(allSql, `Missing table: ${table}`).toContain(`CREATE TABLE ${table}`)
    }
    // memory_fts is a virtual table, not a regular CREATE TABLE
    expect(allSql).toContain('CREATE VIRTUAL TABLE memory_fts USING fts5')
  })

  it('creates all required indexes', () => {
    const execCalls: string[] = []
    const fakeDb = {
      exec: (sql: string) => {
        execCalls.push(sql)
      },
    }

    migration.up(fakeDb)

    const allSql = execCalls.join('\n')
    const expectedIndexes = [
      'idx_sessions_project',
      'idx_sessions_status',
      'idx_messages_session',
      'idx_events_session',
      'idx_events_type',
      'idx_files_session',
      'idx_files_path',
      'idx_artifacts_session',
      'idx_memories_project',
      'idx_memories_type',
      'idx_memories_scope',
      'idx_memories_project_type',
      'idx_memories_project_scope',
      'idx_memories_active',
      'idx_summaries_session',
      'idx_checkpoints_session',
    ]
    for (const idx of expectedIndexes) {
      expect(allSql, `Missing index: ${idx}`).toContain(idx)
    }
  })

  it('creates the partial index on active memories', () => {
    const execCalls: string[] = []
    const fakeDb = {
      exec: (sql: string) => {
        execCalls.push(sql)
      },
    }

    migration.up(fakeDb)

    const allSql = execCalls.join('\n')
    expect(allSql).toContain('idx_memories_active')
    expect(allSql).toContain('WHERE deleted_at IS NULL')
  })

  it('creates FTS sync triggers', () => {
    const execCalls: string[] = []
    const fakeDb = {
      exec: (sql: string) => {
        execCalls.push(sql)
      },
    }

    migration.up(fakeDb)

    const allSql = execCalls.join('\n')
    expect(allSql).toContain('CREATE TRIGGER memories_ai AFTER INSERT ON memories')
    expect(allSql).toContain('CREATE TRIGGER memories_ad AFTER DELETE ON memories')
    expect(allSql).toContain('CREATE TRIGGER memories_au AFTER UPDATE ON memories')
  })

  it('enforces UNIQUE constraint on projects.root_path', () => {
    const execCalls: string[] = []
    const fakeDb = {
      exec: (sql: string) => {
        execCalls.push(sql)
      },
    }

    migration.up(fakeDb)

    const allSql = execCalls.join('\n')
    expect(allSql).toContain('root_path   TEXT NOT NULL UNIQUE')
  })

  it('enforces UNIQUE constraint on session_summaries(session_id, summary_kind)', () => {
    const execCalls: string[] = []
    const fakeDb = {
      exec: (sql: string) => {
        execCalls.push(sql)
      },
    }

    migration.up(fakeDb)

    const allSql = execCalls.join('\n')
    expect(allSql).toContain('UNIQUE(session_id, summary_kind)')
  })
})
