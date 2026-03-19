import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'

let SQL: SqlJsStatic | null = null

export async function __initSqlWasm(): Promise<void> {
  if (!SQL) {
    SQL = await initSqlJs()
  }
}

interface RunResult {
  changes: number
  lastInsertRowid: number
}

type SqlValue = string | number | null | Uint8Array

class StatementWrapper {
  private db: SqlJsDatabase
  private sql: string

  constructor(db: SqlJsDatabase, sql: string) {
    this.db = db
    this.sql = sql
  }

  private normalizeParams(params: unknown[]): SqlValue[] {
    return params.map((p) => (p === undefined ? null : (p as SqlValue)))
  }

  run(...params: unknown[]): RunResult {
    const normalized = this.normalizeParams(params)
    const stmt = this.db.prepare(this.sql)
    try {
      stmt.bind(normalized.length > 0 ? normalized : undefined)
      stmt.step()
    } finally {
      stmt.free()
    }
    return {
      changes: this.db.getRowsModified(),
      lastInsertRowid: 0,
    }
  }

  get(...params: unknown[]): Record<string, SqlValue> | undefined {
    const normalized = this.normalizeParams(params)
    const stmt = this.db.prepare(this.sql)
    try {
      stmt.bind(normalized.length > 0 ? normalized : undefined)
      if (!stmt.step()) return undefined
      return stmt.getAsObject() as Record<string, SqlValue>
    } finally {
      stmt.free()
    }
  }

  all(...params: unknown[]): Record<string, SqlValue>[] {
    const normalized = this.normalizeParams(params)
    const stmt = this.db.prepare(this.sql)
    try {
      stmt.bind(normalized.length > 0 ? normalized : undefined)
      const rows: Record<string, SqlValue>[] = []
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Record<string, SqlValue>)
      }
      return rows
    } finally {
      stmt.free()
    }
  }
}

const WAL_IGNORED_PRAGMAS = ['journal_mode', 'busy_timeout']

class Database {
  private _db: SqlJsDatabase | null

  constructor(_path?: string) {
    if (!SQL) {
      throw new Error('sql.js not initialized. Call __initSqlWasm() first.')
    }
    this._db = new SQL.Database()
  }

  private get db(): SqlJsDatabase {
    if (!this._db) throw new Error('Database is closed')
    return this._db
  }

  prepare(sql: string): StatementWrapper {
    return new StatementWrapper(this.db, sql)
  }

  exec(sql: string): void {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (normalized.includes('using fts5') || normalized.includes('memory_fts')) {
      return
    }
    this.db.run(sql)
  }

  pragma(str: string, opts?: { simple?: boolean }): unknown {
    const match = str.match(/^(\w+)\s*=\s*(.+)$/)
    if (match) {
      const [, name, value] = match
      if (WAL_IGNORED_PRAGMAS.includes(name)) return value
      try {
        this.db.run(`PRAGMA ${name} = ${value}`)
      } catch {
        // ignore pragma errors on in-memory dbs
      }
      return value
    }

    const name = str.trim()
    if (WAL_IGNORED_PRAGMAS.includes(name)) {
      if (name === 'journal_mode') return opts?.simple ? 'memory' : [{ journal_mode: 'memory' }]
      return opts?.simple ? 0 : [{ [name]: 0 }]
    }

    try {
      const results = this.db.exec(`PRAGMA ${name}`)
      if (results.length === 0 || results[0].values.length === 0) {
        return opts?.simple ? undefined : []
      }
      const firstValue = results[0].values[0][0]
      return opts?.simple ? firstValue : results[0].values.map((row) => {
        const obj: Record<string, unknown> = {}
        results[0].columns.forEach((col, i) => { obj[col] = row[i] })
        return obj
      })
    } catch {
      return opts?.simple ? undefined : []
    }
  }

  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
    const self = this
    const wrapped = function (this: unknown, ...args: unknown[]) {
      self.db.run('BEGIN')
      try {
        const result = fn.apply(this, args)
        self.db.run('COMMIT')
        return result
      } catch (err) {
        self.db.run('ROLLBACK')
        throw err
      }
    } as unknown as T
    return wrapped
  }

  close(): void {
    if (this._db) {
      this._db.close()
      this._db = null
    }
  }
}

export default Database
