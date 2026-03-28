#!/usr/bin/env node

/**
 * Fake Claude CLI that emits permission_request events for E2E testing.
 *
 * Behavior:
 * - On any prompt, emits a permission_request for a Bash tool call.
 * - Waits for a permission_response on stdin.
 * - If allowed: emits a normal response and completes.
 * - If denied: emits a result with permission_denials.
 */

const { randomUUID } = require('crypto')

const args = process.argv.slice(2)

function writeEvent(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getArgValue(flag) {
  const index = args.indexOf(flag)
  if (index === -1) return null
  return args[index + 1] ?? null
}

function extractPrompt(payload) {
  if (!payload || payload.type !== 'user') return ''
  const content = payload.message && Array.isArray(payload.message.content)
    ? payload.message.content
    : []

  return content
    .filter((part) => part && part.type === 'text')
    .map((part) => part.text || '')
    .join('\n')
    .trim()
}

function emitVersion() {
  process.stdout.write('claude 0.0.0-e2e\n')
}

function emitAuthStatus() {
  process.stdout.write(JSON.stringify({
    email: 'e2e@local.test',
    subscriptionType: 'Max',
    authMethod: 'mock',
  }))
}

function emitInit(sessionId, model) {
  writeEvent({
    type: 'system',
    subtype: 'init',
    cwd: process.cwd(),
    session_id: sessionId,
    tools: ['Read', 'Edit', 'Write', 'Bash'],
    mcp_servers: [],
    model,
    permissionMode: 'default',
    agents: [],
    skills: [],
    plugins: [],
    claude_code_version: 'e2e-fake-claude-permissions',
    fast_mode_state: 'off',
    uuid: randomUUID(),
  })
}

function emitPermissionRequest(sessionId, questionId) {
  writeEvent({
    type: 'permission_request',
    tool: {
      name: 'Bash',
      description: 'Execute a bash command',
      input: { command: 'echo hello from e2e' },
    },
    question_id: questionId,
    options: [
      { id: 'allow', label: 'Allow', kind: 'allow' },
      { id: 'deny', label: 'Deny', kind: 'deny' },
    ],
    session_id: sessionId,
    uuid: randomUUID(),
  })
}

async function emitAllowedResponse(sessionId, model, prompt) {
  const responseText = `Executed: ${prompt || 'empty prompt'}`

  writeEvent({
    type: 'assistant',
    message: {
      model,
      id: `msg-${randomUUID()}`,
      role: 'assistant',
      content: [{ type: 'text', text: responseText }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 24 },
    },
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: randomUUID(),
  })

  await sleep(20)

  writeEvent({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 120,
    num_turns: 1,
    result: responseText,
    total_cost_usd: 0.0012,
    session_id: sessionId,
    usage: {
      input_tokens: 12,
      output_tokens: 24,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    permission_denials: [],
    uuid: randomUUID(),
  })
}

async function emitDeniedResult(sessionId, questionId) {
  await sleep(20)

  writeEvent({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 50,
    num_turns: 1,
    result: 'Permission denied by user',
    total_cost_usd: 0.0001,
    session_id: sessionId,
    usage: {
      input_tokens: 12,
      output_tokens: 4,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    permission_denials: [
      { tool_name: 'Bash', tool_use_id: questionId },
    ],
    uuid: randomUUID(),
  })
}

// ─── CLI dispatch ───

if (args.length === 1 && (args[0] === '-v' || args[0] === '--version')) {
  emitVersion()
  process.exit(0)
}

if (args[0] === 'auth' && args[1] === 'status') {
  emitAuthStatus()
  process.exit(0)
}

if (args[0] === 'mcp' && args[1] === 'list') {
  process.exit(0)
}

const sessionId = getArgValue('--resume') || randomUUID()
const model = getArgValue('--model') || 'claude-sonnet-4-6'
let responded = false
let buffer = ''
let pendingQuestionId = null
let pendingPrompt = ''

emitInit(sessionId, model)

process.stdin.setEncoding('utf8')

process.stdin.on('data', (chunk) => {
  buffer += chunk
  const lines = buffer.split(/\r?\n/)
  buffer = lines.pop() || ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let payload = null
    try {
      payload = JSON.parse(trimmed)
    } catch {
      continue
    }

    // Handle permission response
    if (payload.type === 'permission_response' && pendingQuestionId) {
      const optionId = payload.option_id
      if (optionId === 'allow' || optionId === 'allow-session') {
        void emitAllowedResponse(sessionId, model, pendingPrompt).then(() => {
          setTimeout(() => process.exit(0), 10)
        })
      } else {
        void emitDeniedResult(sessionId, pendingQuestionId).then(() => {
          setTimeout(() => process.exit(0), 10)
        })
      }
      pendingQuestionId = null
      continue
    }

    // Handle user prompt — emit permission request
    const prompt = extractPrompt(payload)
    if (!prompt && payload.type !== 'user') continue
    if (responded) continue

    responded = true
    pendingPrompt = prompt
    pendingQuestionId = `q-${randomUUID()}`

    // Small delay then emit permission request
    setTimeout(() => {
      emitPermissionRequest(sessionId, pendingQuestionId)
    }, 50)
  }
})

process.stdin.on('end', () => {
  if (!responded) {
    process.exit(0)
  }
})

process.on('SIGINT', () => {
  process.exit(130)
})
