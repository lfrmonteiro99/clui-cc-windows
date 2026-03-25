import { describe, expect, it, beforeEach } from 'vitest'
import type { AgentConfig, RunOptions, TabState } from '../../src/shared/types'

// ─── Test: AgentConfig type shape ───

describe('AgentConfig type', () => {
  it('accepts a named agent config', () => {
    const config: AgentConfig = {
      name: 'code-reviewer',
      description: 'Reviews code changes',
      prompt: 'You are a code review specialist.',
      model: 'claude-sonnet-4-6',
      tools: ['Read', 'Grep', 'Glob'],
    }
    expect(config.name).toBe('code-reviewer')
    expect(config.description).toBe('Reviews code changes')
  })

  it('accepts a minimal agent config (name only)', () => {
    const config: AgentConfig = { name: 'planner' }
    expect(config.name).toBe('planner')
    expect(config.description).toBeUndefined()
    expect(config.prompt).toBeUndefined()
    expect(config.model).toBeUndefined()
    expect(config.tools).toBeUndefined()
  })
})

// ─── Test: RunOptions agent fields ───

describe('RunOptions agent fields', () => {
  it('supports agent name for pre-configured agents', () => {
    const opts: RunOptions = {
      prompt: 'review this PR',
      projectPath: '/tmp/project',
      agent: 'code-reviewer',
    }
    expect(opts.agent).toBe('code-reviewer')
  })

  it('supports agentConfig for custom inline agents', () => {
    const opts: RunOptions = {
      prompt: 'review this PR',
      projectPath: '/tmp/project',
      agentConfig: {
        reviewer: {
          name: 'reviewer',
          description: 'Reviews PRs',
          prompt: 'You review code.',
        },
      },
    }
    expect(opts.agentConfig).toBeDefined()
    expect(opts.agentConfig!['reviewer'].name).toBe('reviewer')
  })
})

// ─── Test: TabState agent fields ───

describe('TabState agent fields', () => {
  it('supports agentName on TabState', () => {
    const tab = {
      agentName: 'code-reviewer',
    } as Partial<TabState>
    expect(tab.agentName).toBe('code-reviewer')
  })

  it('supports parentTabId on TabState', () => {
    const tab = {
      parentTabId: 'parent-tab-123',
    } as Partial<TabState>
    expect(tab.parentTabId).toBe('parent-tab-123')
  })
})

// ─── Test: buildAgentArgs utility ───

describe('buildAgentArgs', () => {
  let buildAgentArgs: (options: RunOptions) => string[]

  beforeEach(async () => {
    const mod = await import('../../src/main/claude/agent-args')
    buildAgentArgs = mod.buildAgentArgs
  })

  it('returns empty array when no agent options set', () => {
    const args = buildAgentArgs({ prompt: 'hello', projectPath: '/tmp' })
    expect(args).toEqual([])
  })

  it('returns --agent <name> when agent name is provided', () => {
    const args = buildAgentArgs({
      prompt: 'hello',
      projectPath: '/tmp',
      agent: 'code-reviewer',
    })
    expect(args).toEqual(['--agent', 'code-reviewer'])
  })

  it('returns --agents <json> when agentConfig is provided', () => {
    const config: Record<string, AgentConfig> = {
      reviewer: {
        name: 'reviewer',
        description: 'Reviews code',
        prompt: 'You review code.',
      },
    }
    const args = buildAgentArgs({
      prompt: 'hello',
      projectPath: '/tmp',
      agentConfig: config,
    })
    expect(args).toHaveLength(2)
    expect(args[0]).toBe('--agents')
    const parsed = JSON.parse(args[1])
    expect(parsed).toHaveProperty('reviewer')
    expect(parsed.reviewer.description).toBe('Reviews code')
  })

  it('prefers agent over agentConfig when both provided', () => {
    const args = buildAgentArgs({
      prompt: 'hello',
      projectPath: '/tmp',
      agent: 'code-reviewer',
      agentConfig: {
        reviewer: { name: 'reviewer', description: 'Reviews code' },
      },
    })
    // Named agent takes precedence
    expect(args).toEqual(['--agent', 'code-reviewer'])
  })
})

// ─── Test: Agent tab grouping limits ───

describe('agent tab grouping', () => {
  it('MAX_AGENT_TABS_PER_GROUP is 5', async () => {
    const { MAX_AGENT_TABS_PER_GROUP } = await import('../../src/main/claude/agent-args')
    expect(MAX_AGENT_TABS_PER_GROUP).toBe(5)
  })
})

// ─── Test: parseAgentListOutput ───

describe('parseAgentListOutput', () => {
  let parseAgentListOutput: (stdout: string) => AgentConfig[]

  beforeEach(async () => {
    const mod = await import('../../src/main/claude/agent-args')
    parseAgentListOutput = mod.parseAgentListOutput
  })

  it('parses JSON array output from claude agents', () => {
    const stdout = JSON.stringify([
      { name: 'code-reviewer', description: 'Reviews code changes' },
      { name: 'planner', description: 'Plans tasks' },
    ])
    const agents = parseAgentListOutput(stdout)
    expect(agents).toHaveLength(2)
    expect(agents[0].name).toBe('code-reviewer')
    expect(agents[1].name).toBe('planner')
  })

  it('returns empty array for empty output', () => {
    expect(parseAgentListOutput('')).toEqual([])
    expect(parseAgentListOutput('  ')).toEqual([])
  })

  it('returns empty array for non-JSON output', () => {
    expect(parseAgentListOutput('No agents configured')).toEqual([])
  })

  it('returns empty array for JSON that is not an array', () => {
    expect(parseAgentListOutput('{"name": "test"}')).toEqual([])
  })

  it('filters out entries without a name field', () => {
    const stdout = JSON.stringify([
      { name: 'valid', description: 'ok' },
      { description: 'no name' },
      { name: '', description: 'empty name' },
    ])
    const agents = parseAgentListOutput(stdout)
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe('valid')
  })
})
