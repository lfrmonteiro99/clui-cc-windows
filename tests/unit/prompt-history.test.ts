import { beforeEach, describe, expect, it } from 'vitest'
import { usePromptHistoryStore } from '../../src/renderer/stores/promptHistoryStore'

describe('promptHistoryStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    usePromptHistoryStore.setState({
      histories: {},
      indices: {},
      drafts: {},
    })
  })

  describe('pushPrompt', () => {
    it('adds a prompt to history', () => {
      usePromptHistoryStore.getState().pushPrompt('tab1', 'hello')
      expect(usePromptHistoryStore.getState().histories['tab1']).toEqual(['hello'])
    })

    it('adds newest prompts to the front', () => {
      const store = usePromptHistoryStore.getState()
      store.pushPrompt('tab1', 'first')
      store.pushPrompt('tab1', 'second')
      expect(usePromptHistoryStore.getState().histories['tab1']).toEqual(['second', 'first'])
    })

    it('caps at 100 entries', () => {
      const store = usePromptHistoryStore.getState()
      for (let i = 0; i < 110; i++) {
        store.pushPrompt('tab1', `prompt-${i}`)
      }
      const history = usePromptHistoryStore.getState().histories['tab1']!
      expect(history.length).toBe(100)
      expect(history[0]).toBe('prompt-109')
      expect(history[99]).toBe('prompt-10')
    })

    it('does not add empty string prompts', () => {
      usePromptHistoryStore.getState().pushPrompt('tab1', '')
      expect(usePromptHistoryStore.getState().histories['tab1']).toBeUndefined()
    })

    it('does not add whitespace-only prompts', () => {
      usePromptHistoryStore.getState().pushPrompt('tab1', '   ')
      expect(usePromptHistoryStore.getState().histories['tab1']).toBeUndefined()
    })

    it('deduplicates consecutive identical prompts', () => {
      const store = usePromptHistoryStore.getState()
      store.pushPrompt('tab1', 'hello')
      store.pushPrompt('tab1', 'hello')
      expect(usePromptHistoryStore.getState().histories['tab1']).toEqual(['hello'])
    })
  })

  describe('navigateUp', () => {
    it('returns previous prompts in reverse order', () => {
      const store = usePromptHistoryStore.getState()
      store.pushPrompt('tab1', 'first')
      store.pushPrompt('tab1', 'second')
      store.pushPrompt('tab1', 'third')

      const r1 = usePromptHistoryStore.getState().navigateUp('tab1', '')
      expect(r1).toBe('third')

      const r2 = usePromptHistoryStore.getState().navigateUp('tab1', 'third')
      expect(r2).toBe('second')

      const r3 = usePromptHistoryStore.getState().navigateUp('tab1', 'second')
      expect(r3).toBe('first')
    })

    it('saves current input as draft on first navigation', () => {
      const store = usePromptHistoryStore.getState()
      store.pushPrompt('tab1', 'old prompt')

      usePromptHistoryStore.getState().navigateUp('tab1', 'my current typing')
      expect(usePromptHistoryStore.getState().drafts['tab1']).toBe('my current typing')
    })

    it('returns null when at end of history', () => {
      const store = usePromptHistoryStore.getState()
      store.pushPrompt('tab1', 'only one')

      usePromptHistoryStore.getState().navigateUp('tab1', '')
      const result = usePromptHistoryStore.getState().navigateUp('tab1', 'only one')
      expect(result).toBeNull()
    })

    it('returns null when history is empty', () => {
      const result = usePromptHistoryStore.getState().navigateUp('tab1', 'something')
      expect(result).toBeNull()
    })
  })

  describe('navigateDown', () => {
    it('returns next prompts ending with draft', () => {
      const store = usePromptHistoryStore.getState()
      store.pushPrompt('tab1', 'first')
      store.pushPrompt('tab1', 'second')

      // Navigate up twice
      usePromptHistoryStore.getState().navigateUp('tab1', 'my draft')
      usePromptHistoryStore.getState().navigateUp('tab1', 'second')

      // Navigate down
      const r1 = usePromptHistoryStore.getState().navigateDown('tab1')
      expect(r1).toBe('second')

      const r2 = usePromptHistoryStore.getState().navigateDown('tab1')
      expect(r2).toBe('my draft')
    })

    it('returns null when already at latest', () => {
      const result = usePromptHistoryStore.getState().navigateDown('tab1')
      expect(result).toBeNull()
    })

    it('returns null when not navigating', () => {
      const store = usePromptHistoryStore.getState()
      store.pushPrompt('tab1', 'something')

      const result = usePromptHistoryStore.getState().navigateDown('tab1')
      expect(result).toBeNull()
    })
  })

  describe('resetIndex', () => {
    it('clears navigation state', () => {
      const store = usePromptHistoryStore.getState()
      store.pushPrompt('tab1', 'hello')
      usePromptHistoryStore.getState().navigateUp('tab1', '')

      expect(usePromptHistoryStore.getState().indices['tab1']).toBe(0)

      usePromptHistoryStore.getState().resetIndex('tab1')
      expect(usePromptHistoryStore.getState().indices['tab1']).toBe(-1)
    })
  })

  describe('clearTab', () => {
    it('removes all history for a tab', () => {
      const store = usePromptHistoryStore.getState()
      store.pushPrompt('tab1', 'hello')
      usePromptHistoryStore.getState().navigateUp('tab1', 'draft')

      usePromptHistoryStore.getState().clearTab('tab1')

      const state = usePromptHistoryStore.getState()
      expect(state.histories['tab1']).toBeUndefined()
      expect(state.indices['tab1']).toBeUndefined()
      expect(state.drafts['tab1']).toBeUndefined()
    })
  })

  describe('per-tab independence', () => {
    it('history is independent per tab', () => {
      const store = usePromptHistoryStore.getState()
      store.pushPrompt('tab1', 'tab1-prompt')
      store.pushPrompt('tab2', 'tab2-prompt')

      expect(usePromptHistoryStore.getState().histories['tab1']).toEqual(['tab1-prompt'])
      expect(usePromptHistoryStore.getState().histories['tab2']).toEqual(['tab2-prompt'])

      // Navigate in tab1 should not affect tab2
      usePromptHistoryStore.getState().navigateUp('tab1', '')
      expect(usePromptHistoryStore.getState().indices['tab1']).toBe(0)
      expect(usePromptHistoryStore.getState().indices['tab2']).toBeUndefined()
    })
  })
})
