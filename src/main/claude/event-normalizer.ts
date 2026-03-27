import type {
  ClaudeEvent,
  NormalizedEvent,
  StreamEvent,
  InitEvent,
  AssistantEvent,
  ResultEvent,
  RateLimitEvent,
  PermissionEvent,
  ContentDelta,
} from '../../shared/types'

/**
 * Tracks which content block indices correspond to tool_use blocks.
 * Populated by content_block_start events, consumed by content_block_stop
 * to decide whether to emit tool_call_complete.
 *
 * The set is message-scoped: it resets on each message_start event.
 */
const toolBlockIndices = new Set<number>()

/**
 * Maps raw Claude stream-json events to canonical CLUI events.
 *
 * The normalizer tracks content block types by index so that
 * content_block_stop only emits tool_call_complete for tool_use blocks,
 * not text blocks. The caller (RunManager) is responsible for sequencing
 * and routing.
 */
export function normalize(raw: ClaudeEvent): NormalizedEvent[] {
  switch (raw.type) {
    case 'system':
      return normalizeSystem(raw as InitEvent)

    case 'stream_event':
      return normalizeStreamEvent(raw as StreamEvent)

    case 'assistant':
      return normalizeAssistant(raw as AssistantEvent)

    case 'result':
      return normalizeResult(raw as ResultEvent)

    case 'rate_limit_event':
      return normalizeRateLimit(raw as RateLimitEvent)

    case 'permission_request':
      return normalizePermission(raw as PermissionEvent)

    default:
      // Unknown event type — skip silently (defensive)
      return []
  }
}

function normalizeSystem(event: InitEvent): NormalizedEvent[] {
  if (event.subtype !== 'init') return []

  return [{
    type: 'session_init',
    sessionId: event.session_id,
    tools: event.tools || [],
    model: event.model || 'unknown',
    mcpServers: event.mcp_servers || [],
    skills: event.skills || [],
    version: event.claude_code_version || 'unknown',
  }]
}

function normalizeStreamEvent(event: StreamEvent): NormalizedEvent[] {
  const sub = event.event
  if (!sub) return []

  switch (sub.type) {
    case 'content_block_start': {
      if (sub.content_block.type === 'tool_use') {
        toolBlockIndices.add(sub.index)
        return [{
          type: 'tool_call',
          toolName: sub.content_block.name || 'unknown',
          toolId: sub.content_block.id || '',
          index: sub.index,
        }]
      }
      // text block start — no event needed, text comes via deltas
      return []
    }

    case 'content_block_delta': {
      const delta = sub.delta as ContentDelta
      if (delta.type === 'text_delta') {
        return [{ type: 'text_chunk', text: delta.text }]
      }
      if (delta.type === 'input_json_delta') {
        return [{
          type: 'tool_call_update',
          toolId: '', // caller can associate via index tracking
          partialInput: delta.partial_json,
        }]
      }
      return []
    }

    case 'content_block_stop': {
      // Only emit tool_call_complete for blocks that started as tool_use.
      // Text block stops should not produce this event.
      if (!toolBlockIndices.has(sub.index)) return []
      toolBlockIndices.delete(sub.index)
      return [{
        type: 'tool_call_complete',
        index: sub.index,
      }]
    }

    case 'message_start':
      toolBlockIndices.clear()
      return []
    case 'message_stop':
      return []

    case 'message_delta': {
      const results: NormalizedEvent[] = []
      const mdEvent = sub as { type: 'message_delta'; delta: { stop_reason: string | null }; usage: import('../../shared/types').UsageData; context_management?: unknown }

      // Extract token usage from message_delta when present
      if (mdEvent.usage && (mdEvent.usage.input_tokens || mdEvent.usage.output_tokens)) {
        const input = mdEvent.usage.input_tokens ?? 0
        const output = mdEvent.usage.output_tokens ?? 0
        results.push({
          type: 'token_usage',
          inputTokens: input,
          outputTokens: output,
          totalTokens: input + output,
          cacheReadTokens: mdEvent.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: mdEvent.usage.cache_creation_input_tokens ?? 0,
        })
      }

      // Extract context_management when present
      if (mdEvent.context_management) {
        results.push({
          type: 'context_management',
          data: mdEvent.context_management,
        })
      }

      return results
    }

    default:
      return []
  }
}

function normalizeAssistant(event: AssistantEvent): NormalizedEvent[] {
  return [{
    type: 'task_update',
    message: event.message,
  }]
}

function normalizeResult(event: ResultEvent): NormalizedEvent[] {
  if (event.is_error || event.subtype === 'error') {
    return [{
      type: 'error',
      message: event.result || 'Unknown error',
      isError: true,
      sessionId: event.session_id,
    }]
  }

  const denials = Array.isArray((event as any).permission_denials)
    ? (event as any).permission_denials.map((d: any) => ({
        toolName: d.tool_name || '',
        toolUseId: d.tool_use_id || '',
      }))
    : undefined

  const results: NormalizedEvent[] = [{
    type: 'task_complete',
    result: event.result || '',
    costUsd: event.total_cost_usd || 0,
    durationMs: event.duration_ms || 0,
    numTurns: event.num_turns || 0,
    usage: event.usage || {},
    sessionId: event.session_id,
    ...(denials && denials.length > 0 ? { permissionDenials: denials } : {}),
  }]

  // Emit token_usage from result event usage data
  const input = event.usage?.input_tokens ?? 0
  const output = event.usage?.output_tokens ?? 0
  if (input > 0 || output > 0) {
    results.push({
      type: 'token_usage',
      inputTokens: input,
      outputTokens: output,
      totalTokens: input + output,
      cacheReadTokens: event.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: event.usage?.cache_creation_input_tokens ?? 0,
    })
  }

  return results
}

function normalizeRateLimit(event: RateLimitEvent): NormalizedEvent[] {
  const info = event.rate_limit_info
  if (!info) return []

  return [{
    type: 'rate_limit',
    status: info.status,
    resetsAt: info.resetsAt,
    rateLimitType: info.rateLimitType,
  }]
}

function normalizePermission(event: PermissionEvent): NormalizedEvent[] {
  return [{
    type: 'permission_request',
    questionId: event.question_id,
    toolName: event.tool?.name || 'unknown',
    toolDescription: event.tool?.description,
    toolInput: event.tool?.input,
    options: (event.options || []).map((o) => ({
      id: o.id,
      label: o.label,
      kind: o.kind,
    })),
  }]
}
