/**
 * Terminal session persistence via IndexedDB (TERM-007).
 *
 * Saves scrollback buffer + CWD + shell on close;
 * restores as visual-only replay on next launch.
 */

const DB_NAME = 'clui-terminal-sessions'
const STORE_NAME = 'sessions'
const DB_VERSION = 1
const MAX_SESSION_SIZE = 100 * 1024 // 100KB per session
const MAX_SESSIONS = 20
const STALE_DAYS = 7

export interface PersistedSession {
  id: string
  serializedBuffer: string
  shell: string
  cwd: string
  exitCode: number | null
  savedAt: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveTerminalSession(session: PersistedSession): Promise<void> {
  try {
    // Enforce max size
    if (new Blob([session.serializedBuffer]).size > MAX_SESSION_SIZE) {
      // Truncate buffer to fit
      session.serializedBuffer = session.serializedBuffer.slice(-MAX_SESSION_SIZE)
    }

    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(session)

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })

    db.close()
    await purgeOldSessions()
  } catch {
    // Graceful degradation — skip persistence silently
  }
}

export async function loadTerminalSessions(): Promise<PersistedSession[]> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()

    const sessions = await new Promise<PersistedSession[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as PersistedSession[])
      request.onerror = () => reject(request.error)
    })

    db.close()
    return sessions.filter((s) => !isStale(s.savedAt))
  } catch {
    return []
  }
}

export async function deleteTerminalSession(id: string): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // silent
  }
}

async function purgeOldSessions(): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()

    const sessions = await new Promise<PersistedSession[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as PersistedSession[])
      request.onerror = () => reject(request.error)
    })

    // Remove stale sessions
    for (const session of sessions) {
      if (isStale(session.savedAt)) {
        store.delete(session.id)
      }
    }

    // Enforce max count — keep most recent
    const valid = sessions.filter((s) => !isStale(s.savedAt)).sort((a, b) => b.savedAt - a.savedAt)
    for (const session of valid.slice(MAX_SESSIONS)) {
      store.delete(session.id)
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // silent
  }
}

function isStale(savedAt: number): boolean {
  return Date.now() - savedAt > STALE_DAYS * 24 * 60 * 60 * 1000
}
