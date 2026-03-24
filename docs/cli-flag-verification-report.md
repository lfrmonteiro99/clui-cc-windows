# Claude Code CLI Flag Verification Report

**Date:** 2026-03-24
**CLI Version:** 2.1.81 (Claude Code)
**Tested by:** Automated spike
**Platform:** Windows 11 (bash shell)

## Summary

| Flag / Feature | Exists | Works with stream-json | Notes |
|---|---|---|---|
| `--fork-session` | Yes | Yes (inferred) | Documented: "use with --resume or --continue" |
| `!` shell passthrough | No flag | N/A | Not a CLI flag; interactive-mode UX feature only |
| `--effort <level>` | Yes | Yes (inferred) | Choices: low, medium, high, max |
| `--agent` / `--agents` | Yes | Yes (inferred) | Both single-agent and JSON multi-agent definitions |
| `--from-pr [value]` | Yes | Partial | "Resume a session linked to a PR"; interactive picker mode may not work with `-p` |
| summarization / compaction | No flag | N/A | No CLI flag; happens internally. `context_management` field in `message_delta` events |
| token usage in events | Yes (events) | Yes | `result` event includes `usage`, `total_cost_usd`, `input_tokens`, `output_tokens` |
| `--max-budget-usd` | Yes | Yes | "only works with --print" |
| `--max-turns` | No | N/A | Not in --help output; run-manager.ts uses it (line 155) — may be silently ignored or removed |

## Flags Already Used by CLUI (run-manager.ts baseline)

These flags are confirmed working in production via `src/main/claude/run-manager.ts`:

| Flag | Line | Purpose |
|---|---|---|
| `-p` / `--print` | 115 | Non-interactive mode |
| `--input-format stream-json` | 116 | Bidirectional streaming |
| `--output-format stream-json` | 117 | NDJSON event output |
| `--verbose` | 118 | Verbose output |
| `--include-partial-messages` | 119 | Streaming partial content |
| `--permission-mode default` | 120 | Permission handling |
| `--resume <sessionId>` | 124 | Session resumption |
| `--model <model>` | 127 | Model selection |
| `--add-dir <dir>` | 131 | Additional directory access |
| `--settings <path>` | 139 | Hook settings file |
| `--allowedTools <tools>` | 144 | Tool auto-approval |
| `--max-turns <n>` | 155 | **WARNING: Not in --help. May be dead code.** |
| `--max-budget-usd <n>` | 158 | Budget cap |
| `--append-system-prompt-file` | 166 (via buildPromptArgs) | System prompt injection |

## Detailed Results

### 1. Session Forking (`--fork-session`)

**Status: EXISTS, READY TO USE**

```
--fork-session   When resuming, create a new session ID instead of reusing
                 the original (use with --resume or --continue)
```

- Available in CLI v2.1.81.
- Must be combined with `--resume <sessionId>` or `--continue`.
- Expected behavior: creates a new session branched from the original conversation history.
- Compatible with `-p` and `--output-format stream-json` (no restrictions mentioned in help text).
- The `system.init` event should return the new `session_id`, which run-manager already captures (line 212).

**Integration path:** Add `--fork-session` to args in `startRun()` when `options.forkSession` is true.

### 2. Inline Shell (`!` passthrough)

**Status: NOT A CLI FLAG**

- No `--shell` or `!`-related flag exists in `--help`.
- The `!` prefix is an interactive-mode feature (REPL), not available in `-p` (print) mode.
- CLUI uses `-p` mode exclusively, so native `!` passthrough is not available.

**Workaround options:**
- **Option A (recommended):** Detect `!` prefix in the renderer, strip it, and spawn a separate shell process (not via Claude CLI). Display output inline.
- **Option B:** Send the command as a normal prompt with instructions like "Run this shell command: `<cmd>`" — Claude will use its Bash tool.
- **Option C:** Use `--input-format stream-json` to send a tool invocation directly (if the protocol supports it; undocumented).

### 3. Effort Levels (`--effort`)

**Status: EXISTS, READY TO USE**

```
--effort <level>   Effort level for the current session (low, medium, high, max)
```

- Four levels: `low`, `medium`, `high`, `max`.
- No restriction mentioned for `-p` mode — should work with stream-json.
- No environment variable alternative found in help text (but may exist via settings).

**Integration path:** Add `--effort <level>` to args in `startRun()` when `options.effort` is set.

### 4. Multi-Agent (`--agent` / `--agents`)

**Status: EXISTS, READY TO USE**

```
--agent <agent>    Agent for the current session. Overrides the 'agent' setting.
--agents <json>    JSON object defining custom agents
```

- `--agent <name>` selects a pre-configured agent.
- `--agents <json>` defines inline agents with description and prompt.
- `claude agents` subcommand lists configured agents (14 active on this system).
- Both user-defined and built-in agents available.
- `--brief` flag enables `SendUserMessage` tool for agent-to-user communication.

**Integration path:**
- For agent selection: add `--agent <name>` to args.
- For custom agents: add `--agents '<json>'` to args.
- List available agents via `claude agents` subprocess.

### 5. PR Review (`--from-pr`)

**Status: EXISTS, PARTIAL COMPATIBILITY**

```
--from-pr [value]   Resume a session linked to a PR by PR number/URL,
                    or open interactive picker with optional search term
```

- Accepts PR number or URL as value.
- Without a value, opens an interactive picker — this will NOT work with `-p` mode.
- When given an explicit PR number/URL, should work with `-p` mode (needs testing).
- Likely requires git context and GitHub CLI (`gh`) to be available.

**Integration path:**
- Always provide an explicit PR number/URL (never use interactive picker mode).
- Combine with `-p --output-format stream-json` for CLUI integration.
- Test: `claude -p --output-format stream-json --from-pr 123 "Review this PR"` to confirm compatibility.

### 6. Context Compaction / Summarization

**Status: NO CLI FLAG — INTERNAL MECHANISM**

- No `--compact`, `--summarize`, or `--context-management` flag exists.
- Context compaction is an internal Claude Code behavior triggered automatically when context window fills.
- The `message_delta` event type already includes an optional `context_management` field (defined in `src/shared/types.ts` line 33).
- This field is typed as `unknown` — its structure needs to be captured and documented from live events.

**Integration path:**
- **Phase A:** Monitor `context_management` field in `message_delta` events. Add handling in event-normalizer to surface compaction events to the UI.
- **Phase B:** If the CLI later adds a manual trigger (e.g., `/compact` slash command or `--compact` flag), integrate that.
- No CLI-side work needed for Phase A — purely event parsing.

### 7. Token Usage in Events

**Status: EXISTS, ALREADY INTEGRATED**

The `result` event includes comprehensive usage data:
- `total_cost_usd` — total API cost
- `duration_ms` — run duration
- `num_turns` — conversation turns
- `usage.input_tokens` — input token count
- `usage.output_tokens` — output token count
- `usage.cache_read_input_tokens` — cache hit tokens
- `usage.cache_creation_input_tokens` — cache write tokens

The `message_delta` stream event also includes per-message `usage` data.

CLUI already extracts `costUsd`, `durationMs`, `numTurns`, and `usage` in the event normalizer (line 136-141 of event-normalizer.ts).

**Status:** Fully integrated. No additional CLI flags needed.

### 8. Max Budget (`--max-budget-usd`)

**Status: EXISTS, ALREADY INTEGRATED**

```
--max-budget-usd <amount>   Maximum dollar amount to spend on API calls
                            (only works with --print)
```

- Already used in run-manager.ts (line 158-159).
- Works with `-p` mode (explicitly documented).

### 9. Max Turns (formerly `--max-turns`)

**Status: NOT IN HELP — POTENTIAL DEAD CODE**

- `run-manager.ts` passes `--max-turns` (line 154-156) but this flag does NOT appear in `claude --help` output for v2.1.81.
- This flag may have been removed or renamed in a recent CLI update.
- It may be silently accepted and ignored, or it may cause an error that gets swallowed.

**Action required:** Test whether `--max-turns` causes errors or is silently ignored. If removed, the `maxTurns` option in `RunOptions` is dead code that should be cleaned up.

## Additional Flags of Interest

Discovered during verification, potentially useful for future features:

| Flag | Description | Potential Use |
|---|---|---|
| `--worktree [name]` | Create git worktree for session | Sandbox/isolation features |
| `--bare` | Minimal mode, skip hooks/LSP/etc | Fast lightweight queries |
| `--fallback-model <model>` | Auto-fallback on overload | Reliability improvement |
| `--json-schema <schema>` | Structured output validation | Typed responses |
| `--no-session-persistence` | Don't save session to disk | Ephemeral/scratch tabs |
| `--session-id <uuid>` | Use specific session ID | Deterministic session management |
| `--replay-user-messages` | Echo user messages back on stdout | Input acknowledgment |
| `--name <name>` | Display name for session | Tab naming |
| `--tools <tools>` | Specify available tool set | Tool restriction per tab |

## Impact on Downstream Issues

| Issue | Flag Status | Recommendation |
|---|---|---|
| #171 Session Forking | `--fork-session` exists | **Proceed.** Flag is available and compatible. Add to RunOptions and wire through ControlPlane. |
| #172 Inline Shell | No CLI flag | **Option B recommended.** Let Claude use its Bash tool via normal prompting. Option A (custom shell spawn) adds complexity for marginal UX gain. |
| #173 Context Compaction | No CLI flag; events exist | **Proceed Phase A.** Parse `context_management` from `message_delta` events. Surface in UI. No manual trigger available yet. |
| #174 Multi-Agent | `--agent` and `--agents` exist | **Proceed.** Both agent selection and inline agent definitions are available. Wire `claude agents` for discovery. |
| #175 Editor Compose | No CLI dependency | **Proceed.** Pure renderer feature. |
| #176 Effort Levels | `--effort` exists | **Proceed.** Four levels available. Wire through RunOptions. |
| #177 PR Review | `--from-pr` exists | **Proceed with caution.** Must always provide explicit PR number/URL (no interactive picker). Needs integration test to confirm `-p` compatibility. |

## Risks and Open Questions

1. **`--max-turns` removal:** Confirm whether this flag is silently ignored or causes errors. If removed, clean up dead code in run-manager.ts.
2. **`--from-pr` + `-p` compatibility:** The help text says "open interactive picker" without a value. Need to verify that providing an explicit value works in non-interactive mode.
3. **`context_management` field shape:** Typed as `unknown`. Need to capture real events to define the actual type structure.
4. **`--effort` interaction with `--max-budget-usd`:** Unclear if `max` effort level respects budget caps or if it can blow through them.
