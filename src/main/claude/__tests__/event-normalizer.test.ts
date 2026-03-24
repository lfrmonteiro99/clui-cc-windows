import { describe, it, expect } from 'vitest'
import { normalize } from '../event-normalizer'
import type { ResultEvent, StreamEvent } from '../../../shared/types'

describe('event-normalizer', () => {
  describe('token_usage from result events', () => {
    it('emits token_usage event from a successful result', () => {
      const raw: ResultEvent = {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 5000,
        num_turns: 3,
        result: 'Done.',
        total_cost_usd: 0.05,
        session_id: 'sess-1',
        usage: {
          input_tokens: 12000,
          output_tokens: 3000,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 1000,
        },
        permission_denials: [],
        uuid: 'uuid-1',
      }

      const events = normalize(raw)
      const tokenEvent = events.find((e) => e.type === 'token_usage')

      expect(tokenEvent).toBeDefined()
      expect(tokenEvent).toEqual({
        type: 'token_usage',
        inputTokens: 12000,
        outputTokens: 3000,
        totalTokens: 15000,
        cacheReadTokens: 5000,
        cacheWriteTokens: 1000,
      })
    })

    it('emits token_usage with zero cache tokens when absent', () => {
      const raw: ResultEvent = {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 1000,
        num_turns: 1,
        result: 'Done.',
        total_cost_usd: 0.01,
        session_id: 'sess-2',
        usage: {
          input_tokens: 800,
          output_tokens: 200,
        },
        permission_denials: [],
        uuid: 'uuid-2',
      }

      const events = normalize(raw)
      const tokenEvent = events.find((e) => e.type === 'token_usage')

      expect(tokenEvent).toEqual({
        type: 'token_usage',
        inputTokens: 800,
        outputTokens: 200,
        totalTokens: 1000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })
    })

    it('does not emit token_usage for error results', () => {
      const raw: ResultEvent = {
        type: 'result',
        subtype: 'error',
        is_error: true,
        duration_ms: 100,
        num_turns: 0,
        result: 'Something broke',
        total_cost_usd: 0,
        session_id: 'sess-3',
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
        permission_denials: [],
        uuid: 'uuid-3',
      }

      const events = normalize(raw)
      const tokenEvent = events.find((e) => e.type === 'token_usage')
      expect(tokenEvent).toBeUndefined()
    })
  })

  describe('context_management from message_delta events', () => {
    it('emits context_management event when field is present', () => {
      const raw: StreamEvent = {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: null },
          usage: { input_tokens: 100, output_tokens: 50 },
          context_management: { type: 'auto_compact', summary: 'Compacted 20k tokens' },
        },
        session_id: 'sess-4',
        parent_tool_use_id: null,
        uuid: 'uuid-4',
      }

      const events = normalize(raw)
      const ctxEvent = events.find((e) => e.type === 'context_management')

      expect(ctxEvent).toBeDefined()
      expect(ctxEvent).toEqual({
        type: 'context_management',
        data: { type: 'auto_compact', summary: 'Compacted 20k tokens' },
      })
    })

    it('emits token_usage from message_delta usage field', () => {
      const raw: StreamEvent = {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 5000, output_tokens: 1200 },
        },
        session_id: 'sess-5',
        parent_tool_use_id: null,
        uuid: 'uuid-5',
      }

      const events = normalize(raw)
      const tokenEvent = events.find((e) => e.type === 'token_usage')

      expect(tokenEvent).toEqual({
        type: 'token_usage',
        inputTokens: 5000,
        outputTokens: 1200,
        totalTokens: 6200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })
    })

    it('does not emit events for message_delta without context_management or usage', () => {
      const raw: StreamEvent = {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: null },
          usage: {},
        },
        session_id: 'sess-6',
        parent_tool_use_id: null,
        uuid: 'uuid-6',
      }

      const events = normalize(raw)
      expect(events.filter((e) => e.type === 'context_management')).toHaveLength(0)
      expect(events.filter((e) => e.type === 'token_usage')).toHaveLength(0)
    })
  })
})
