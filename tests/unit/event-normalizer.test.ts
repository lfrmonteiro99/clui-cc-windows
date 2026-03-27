import { describe, it, expect } from 'vitest'
import { normalize } from '../../src/main/claude/event-normalizer'

describe('EventNormalizer', () => {
  describe('system/init events', () => {
    it('normalizes a system init event to session_init', () => {
      const raw = {
        type: 'system' as const,
        subtype: 'init' as const,
        session_id: 'sess-123',
        tools: ['Read', 'Write'],
        model: 'claude-sonnet-4-5-20250514',
        mcp_servers: [{ name: 'test', status: 'connected' }],
        skills: ['skill-creator'],
        claude_code_version: '2.1.71',
        cwd: '/tmp',
        permissionMode: 'acceptEdits',
        agents: [],
        plugins: [],
        fast_mode_state: 'off',
        uuid: 'uuid-1',
      }

      const result = normalize(raw)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        type: 'session_init',
        sessionId: 'sess-123',
        tools: ['Read', 'Write'],
        model: 'claude-sonnet-4-5-20250514',
      })
    })

    it('returns empty array for non-init system events', () => {
      const raw = {
        type: 'system' as const,
        subtype: 'other' as any,
        session_id: 'x',
        cwd: '/',
        tools: [],
        mcp_servers: [],
        model: '',
        permissionMode: '',
        agents: [],
        skills: [],
        plugins: [],
        claude_code_version: '',
        fast_mode_state: '',
        uuid: '',
      }
      expect(normalize(raw)).toEqual([])
    })
  })

  describe('stream events', () => {
    it('normalizes text_delta to text_chunk', () => {
      const raw = {
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u1',
        event: {
          type: 'content_block_delta' as const,
          index: 0,
          delta: { type: 'text_delta' as const, text: 'Hello' },
        },
      }

      const result = normalize(raw)
      expect(result).toEqual([{ type: 'text_chunk', text: 'Hello' }])
    })

    it('normalizes tool_use content_block_start to tool_call', () => {
      const raw = {
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u1',
        event: {
          type: 'content_block_start' as const,
          index: 1,
          content_block: { type: 'tool_use' as const, id: 'tool-1', name: 'Read' },
        },
      }

      const result = normalize(raw)
      expect(result).toEqual([{
        type: 'tool_call',
        toolName: 'Read',
        toolId: 'tool-1',
        index: 1,
      }])
    })

    it('normalizes input_json_delta to tool_call_update', () => {
      const raw = {
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u1',
        event: {
          type: 'content_block_delta' as const,
          index: 1,
          delta: { type: 'input_json_delta' as const, partial_json: '{"path":' },
        },
      }

      const result = normalize(raw)
      expect(result).toEqual([{
        type: 'tool_call_update',
        toolId: '',
        partialInput: '{"path":',
      }])
    })

    it('normalizes content_block_stop to tool_call_complete', () => {
      const raw = {
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u1',
        event: {
          type: 'content_block_stop' as const,
          index: 1,
        },
      }

      const result = normalize(raw)
      expect(result).toEqual([{ type: 'tool_call_complete', index: 1 }])
    })

    it('returns empty for message_start and message_stop structural events', () => {
      for (const subType of ['message_start', 'message_stop'] as const) {
        const raw = {
          type: 'stream_event' as const,
          session_id: 's1',
          parent_tool_use_id: null,
          uuid: 'u1',
          event: { type: subType, message: {}, delta: {}, usage: {} } as any,
        }
        expect(normalize(raw)).toEqual([])
      }
    })

    it('returns empty for message_delta with no usage data', () => {
      const raw = {
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u1',
        event: { type: 'message_delta' as const, delta: { stop_reason: 'end_turn' }, usage: {} },
      }
      expect(normalize(raw)).toEqual([])
    })

    it('extracts token_usage from message_delta with usage data', () => {
      const raw = {
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u1',
        event: {
          type: 'message_delta' as const,
          delta: { stop_reason: 'end_turn' },
          usage: {
            input_tokens: 500,
            output_tokens: 200,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 50,
          },
        },
      }

      const result = normalize(raw)
      expect(result).toContainEqual({
        type: 'token_usage',
        inputTokens: 500,
        outputTokens: 200,
        totalTokens: 700,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
      })
    })

    it('extracts context_management from message_delta when present', () => {
      const raw = {
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u1',
        event: {
          type: 'message_delta' as const,
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 100, output_tokens: 50 },
          context_management: { action: 'compact', tokens_freed: 5000 },
        },
      }

      const result = normalize(raw)
      expect(result).toContainEqual({
        type: 'context_management',
        data: { action: 'compact', tokens_freed: 5000 },
      })
    })

    it('emits both token_usage and context_management from single message_delta', () => {
      const raw = {
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u1',
        event: {
          type: 'message_delta' as const,
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 100, output_tokens: 50 },
          context_management: { action: 'compact' },
        },
      }

      const result = normalize(raw)
      expect(result).toHaveLength(2)
      expect(result[0].type).toBe('token_usage')
      expect(result[1].type).toBe('context_management')
    })
  })

  describe('result events', () => {
    it('normalizes successful result to task_complete with token_usage', () => {
      const raw = {
        type: 'result' as const,
        subtype: 'success' as const,
        result: 'Done',
        is_error: false,
        session_id: 's1',
        total_cost_usd: 0.05,
        duration_ms: 1200,
        num_turns: 3,
        usage: { input_tokens: 100, output_tokens: 50 },
      }

      const result = normalize(raw)
      // task_complete + token_usage
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        type: 'task_complete',
        result: 'Done',
        costUsd: 0.05,
        durationMs: 1200,
        numTurns: 3,
        sessionId: 's1',
      })
      expect(result[1]).toMatchObject({
        type: 'token_usage',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      })
    })

    it('emits only task_complete when result has no token usage', () => {
      const raw = {
        type: 'result' as const,
        subtype: 'success' as const,
        result: 'Done',
        is_error: false,
        session_id: 's1',
        total_cost_usd: 0,
        duration_ms: 100,
        num_turns: 1,
        usage: { input_tokens: 0, output_tokens: 0 },
      }

      const result = normalize(raw)
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('task_complete')
    })

    it('normalizes error result to error event', () => {
      const raw = {
        type: 'result' as const,
        subtype: 'error' as const,
        result: 'API key invalid',
        is_error: true,
        session_id: 's1',
        total_cost_usd: 0,
        duration_ms: 100,
        num_turns: 0,
        usage: {},
      }

      const result = normalize(raw)
      expect(result).toEqual([{
        type: 'error',
        message: 'API key invalid',
        isError: true,
        sessionId: 's1',
      }])
    })
  })

  describe('BUG-005: content_block_stop should only emit tool_call_complete for tool blocks', () => {
    it('does NOT emit tool_call_complete for text block stop', () => {
      // First: content_block_start for a text block (index 0)
      const startRaw = {
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u1',
        event: {
          type: 'content_block_start' as const,
          index: 0,
          content_block: { type: 'text' as const, text: '' },
        },
      }
      // Notify normalizer of the text block start
      normalize(startRaw)

      // Then: content_block_stop for index 0 (text block)
      const stopRaw = {
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u2',
        event: {
          type: 'content_block_stop' as const,
          index: 0,
        },
      }

      const result = normalize(stopRaw)
      // Should NOT produce tool_call_complete for a text block
      expect(result.every((e) => e.type !== 'tool_call_complete')).toBe(true)
    })

    it('emits tool_call_complete only for tool_use block stop', () => {
      // content_block_start for a tool_use block (index 1)
      const startRaw = {
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u3',
        event: {
          type: 'content_block_start' as const,
          index: 1,
          content_block: { type: 'tool_use' as const, id: 'tool-1', name: 'Read' },
        },
      }
      normalize(startRaw)

      // content_block_stop for index 1 (tool_use block)
      const stopRaw = {
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u4',
        event: {
          type: 'content_block_stop' as const,
          index: 1,
        },
      }

      const result = normalize(stopRaw)
      expect(result).toEqual([{ type: 'tool_call_complete', index: 1 }])
    })

    it('handles interleaved text and tool blocks correctly', () => {
      // text block at index 0
      normalize({
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u5',
        event: {
          type: 'content_block_start' as const,
          index: 0,
          content_block: { type: 'text' as const, text: '' },
        },
      })
      // tool block at index 1
      normalize({
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u6',
        event: {
          type: 'content_block_start' as const,
          index: 1,
          content_block: { type: 'tool_use' as const, id: 'tool-2', name: 'Write' },
        },
      })

      // Stop text block — should NOT emit tool_call_complete
      const textStop = normalize({
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u7',
        event: { type: 'content_block_stop' as const, index: 0 },
      })
      expect(textStop.every((e) => e.type !== 'tool_call_complete')).toBe(true)

      // Stop tool block — SHOULD emit tool_call_complete
      const toolStop = normalize({
        type: 'stream_event' as const,
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: 'u8',
        event: { type: 'content_block_stop' as const, index: 1 },
      })
      expect(toolStop).toEqual([{ type: 'tool_call_complete', index: 1 }])
    })
  })

  describe('unknown events', () => {
    it('returns empty array for unknown event types', () => {
      const raw = { type: 'completely_unknown' } as any
      expect(normalize(raw)).toEqual([])
    })
  })
})
