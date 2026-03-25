/**
 * Agent argument builder for CLI subprocess spawning.
 *
 * Translates RunOptions agent fields into CLI flags:
 *   - `options.agent` → `--agent <name>` (pre-configured agent)
 *   - `options.agentConfig` → `--agents '<json>'` (custom inline agents)
 *
 * Named agents take precedence over inline config when both are set.
 */

import type { AgentConfig, RunOptions } from '../../shared/types'

/** Maximum agent tabs per parent group (backpressure) */
export const MAX_AGENT_TABS_PER_GROUP = 5

/**
 * Build CLI args for agent mode.
 * Returns empty array if no agent options are set.
 */
export function buildAgentArgs(options: RunOptions): string[] {
  // Named agent takes precedence — simpler CLI invocation, avoids JSON on command line
  if (options.agent) {
    return ['--agent', options.agent]
  }

  if (options.agentConfig && Object.keys(options.agentConfig).length > 0) {
    // Serialize to compact JSON for --agents flag
    const json = JSON.stringify(options.agentConfig)
    return ['--agents', json]
  }

  return []
}

/**
 * Parse output from `claude agents` (or `claude agents --json`).
 * Returns an array of AgentConfig objects.
 *
 * Handles:
 *  - JSON array output
 *  - Empty/whitespace output
 *  - Non-JSON output (e.g. "No agents configured")
 *  - Filters entries missing a `name` field
 */
export function parseAgentListOutput(stdout: string): AgentConfig[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) return []

    return parsed.filter(
      (entry: unknown): entry is AgentConfig =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as AgentConfig).name === 'string' &&
        (entry as AgentConfig).name.length > 0,
    )
  } catch {
    return []
  }
}
