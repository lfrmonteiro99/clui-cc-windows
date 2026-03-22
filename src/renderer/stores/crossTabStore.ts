/**
 * Cross-Tab Radar Store — maintains a keyword index per tab and finds
 * related tabs when the user starts typing a new prompt.
 */

import { create } from 'zustand'
import { extractKeywords, keywordOverlapScore } from '../../shared/keyword-extractor'
import type { Message } from '../../shared/types'

interface TabKeywords {
  tabId: string
  keywords: string[]
  lastUpdated: number
  title: string
}

export interface TabMatch {
  tabId: string
  title: string
  matchedKeywords: string[]
  lastUpdated: number
  score: number
}

interface CrossTabState {
  /** Per-tab keyword indices */
  tabIndex: Record<string, TabKeywords>
  /** Update keyword index for a tab */
  updateIndex: (tabId: string, messages: Message[], title: string) => void
  /** Remove a tab from the index */
  removeTab: (tabId: string) => void
  /** Find tabs with similar content to a query string */
  findRelated: (query: string, excludeTabId: string) => TabMatch[]
}

/** Minimum score to consider a match */
const MIN_MATCH_SCORE = 0.3

export const useCrossTabStore = create<CrossTabState>((set, get) => ({
  tabIndex: {},

  updateIndex: (tabId, messages, title) => {
    // Extract keywords from all user and assistant messages
    const allText = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => m.content)
      .join(' ')

    const keywords = extractKeywords(allText)

    set((state) => ({
      tabIndex: {
        ...state.tabIndex,
        [tabId]: { tabId, keywords, lastUpdated: Date.now(), title },
      },
    }))
  },

  removeTab: (tabId) => {
    set((state) => {
      const { [tabId]: _, ...rest } = state.tabIndex
      return { tabIndex: rest }
    })
  },

  findRelated: (query, excludeTabId) => {
    const queryKeywords = extractKeywords(query)
    if (queryKeywords.length < 2) return [] // Need at least 2 keywords

    const index = get().tabIndex
    const matches: TabMatch[] = []

    for (const [tabId, entry] of Object.entries(index)) {
      if (tabId === excludeTabId) continue

      const score = keywordOverlapScore(queryKeywords, entry.keywords)
      if (score >= MIN_MATCH_SCORE) {
        const matchedKeywords = queryKeywords.filter((kw) =>
          entry.keywords.includes(kw)
        )
        matches.push({
          tabId,
          title: entry.title,
          matchedKeywords,
          lastUpdated: entry.lastUpdated,
          score,
        })
      }
    }

    // Sort by score descending
    return matches.sort((a, b) => b.score - a.score).slice(0, 3)
  },
}))
