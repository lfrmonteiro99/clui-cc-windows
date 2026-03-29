/**
 * Chat session persistence via IndexedDB (#313).
 *
 * Saves messages + metadata on status/message change;
 * restores as dead tabs with conversation history on next launch.
 * Follows the same pattern as terminal-persistence.ts.
 */

const DB_NAME = 'clui-chat-sessions'
const STORE_NAME = 'sessions'
const DB_VERSION = 1
const MAX_SESSIONS = 20
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MAX_SIZE_BYTES = 200 * 1024 // 200KB per session

export interface PersistedChatSession {
  tabId: string
  claudeSessionId: string | null
  messages: Array<{ id: string; role: string; content: string; timestamp: number }>
  title: string
  workingDirectory: string
  savedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'tabId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Trim messages array so its JSON serialization stays under MAX_SIZE_BYTES.
 * Keeps the most recent messages, dropping oldest first.
 */
function trimMessagesToFit(
  messages: PersistedChatSession['messages'],
): PersistedChatSession['messages'] {
  let current = messages
  while (current.length > 1) {
    const serialized = JSON.stringify(current)
    if (new Blob([serialized]).size <= MAX_SIZE_BYTES) return current
    // Drop the oldest message
    current = current.slice(1)
  }
  return current
}

export async function saveChatSession(session: PersistedChatSession): Promise<void> {
  try {
    // Enforce max size by trimming messages
    session = { ...session, messages: trimMessagesToFit(session.messages) }

    const db = await openDb()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(session)

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })

    db.close()
    await purgeOldSessions()
  } catch (err) {
    console.warn('[session-persistence] Failed to save session:', err)
  }
}

export async function loadChatSessions(): Promise<PersistedChatSession[]> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()

    const sessions = await new Promise<PersistedChatSession[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as PersistedChatSession[])
      request.onerror = () => reject(request.error)
    })

    db.close()
    return sessions.filter((s) => !isStale(s.savedAt))
  } catch (err) {
    console.warn('[session-persistence] Failed to load sessions:', err)
    return []
  }
}

export async function deleteChatSession(tabId: string): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(tabId)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (err) {
    console.warn('[session-persistence] Failed to delete session:', err)
  }
}

export async function purgeOldSessions(): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()

    const sessions = await new Promise<PersistedChatSession[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as PersistedChatSession[])
      request.onerror = () => reject(request.error)
    })

    // Remove stale sessions
    for (const session of sessions) {
      if (isStale(session.savedAt)) {
        store.delete(session.tabId)
      }
    }

    // Enforce max count — keep most recent
    const valid = sessions.filter((s) => !isStale(s.savedAt)).sort((a, b) => b.savedAt - a.savedAt)
    for (const session of valid.slice(MAX_SESSIONS)) {
      store.delete(session.tabId)
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (err) {
    console.warn('[session-persistence] Failed to purge old sessions:', err)
  }
}

function isStale(savedAt: number): boolean {
  return Date.now() - savedAt > MAX_AGE_MS
}
