/**
 * ENRICH-008: Session Digest
 *
 * Extracts, stores, and formats digests of past sessions for context injection.
 */

import type { Message } from '../types'

export interface DigestSettings {
  enabled: boolean
  maxDigests: number
  maxMessageLength: number
}

export interface SessionDigest {
  id: string
  tabId: string
  title: string
  summary: string
  createdAt: number
  messageCount: number
}

const DEFAULT_SETTINGS: DigestSettings = {
  enabled: true,
  maxDigests: 50,
  maxMessageLength: 200,
}

/**
 * In-memory digest storage with JSON serialization.
 * Uses an injected read/write interface for testability.
 */
export class DigestStore {
  private digests: SessionDigest[] = []
  private settings: DigestSettings = { ...DEFAULT_SETTINGS }

  constructor(
    private readFn: (key: string) => string | null,
    private writeFn: (key: string, value: string) => void,
  ) {
    this.loadSettings()
    this.loadDigests()
  }

  // ─── Settings ───

  private loadSettings(): void {
    try {
      const raw = this.readFn('clui-digest-settings')
      if (raw) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
      }
    } catch (err) {
      console.warn('[DigestStore] settings load failed:', err)
    }
  }

  saveSettings(partial: Partial<DigestSettings>): void {
    this.settings = { ...this.settings, ...partial }
    try {
      this.writeFn('clui-digest-settings', JSON.stringify(this.settings))
    } catch (err) {
      console.warn('[DigestStore] settings save failed:', err)
    }
  }

  getSettings(): DigestSettings {
    return { ...this.settings }
  }

  // ─── Digests ───

  private loadDigests(): void {
    try {
      const raw = this.readFn('clui-digests')
      if (raw) {
        this.digests = JSON.parse(raw)
      }
    } catch (err) {
      console.warn('[DigestStore] digests load failed:', err)
    }
  }

  private persistDigests(): void {
    try {
      this.writeFn('clui-digests', JSON.stringify(this.digests))
    } catch (err) {
      console.warn('[DigestStore] digests persist failed:', err)
    }
  }

  saveDigest(digest: SessionDigest): void {
    this.digests.push(digest)
    this.purge()
    this.persistDigests()
  }

  loadAllDigests(): SessionDigest[] {
    return [...this.digests]
  }

  /**
   * Purge oldest digests if over the configured max.
   */
  private purge(): void {
    if (this.digests.length > this.settings.maxDigests) {
      this.digests = this.digests
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, this.settings.maxDigests)
    }
  }
}

/**
 * Extract a digest-ready summary from a messages array.
 * Truncates each message to maxLength characters.
 */
export function extractForDigest(
  messages: Message[],
  maxLength = 200,
): Array<{ role: string; text: string }> {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const text = m._textChunks ? m._textChunks.join('') : m.content
      const truncated = text.length > maxLength ? text.slice(0, maxLength) + '...' : text
      return { role: m.role, text: truncated }
    })
}

/**
 * Build a context injection string from stored digests.
 * Optionally excludes a specific tab to avoid self-injection.
 */
export function buildContextInjection(
  digests: SessionDigest[],
  excludeTabId?: string,
): string {
  const filtered = excludeTabId
    ? digests.filter((d) => d.tabId !== excludeTabId)
    : digests

  if (filtered.length === 0) return ''

  const lines = filtered.map(
    (d) => `- [${d.title}] (${d.messageCount} messages): ${d.summary}`,
  )

  return `Previous session context:\n${lines.join('\n')}`
}
