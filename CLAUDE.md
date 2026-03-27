# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Clui CC is an Electron desktop overlay that wraps the Claude Code CLI (`claude -p --output-format stream-json`) in a floating pill UI with multi-tab sessions, permission approval, marketplace, and voice input. It does NOT call the Anthropic API directly — it spawns CLI subprocesses. Supports macOS (production), Windows (beta), and Linux (beta — AppImage/deb/rpm).

## Commands

| Action | Command |
|--------|---------|
| Install deps | `npm install` |
| Dev mode (hot-reload renderer) | `npm run dev` |
| Type-check + build | `npm run build` |
| Run tests | `npm run test` |
| Tests in watch mode | `npm run test:watch` |
| Environment diagnostics | `npm run doctor` |
| Debug logging | `CLUI_DEBUG=1 npm run dev` (writes `~/.clui-debug.log`) |
| Toggle overlay | `Alt+Space` (macOS) / `Ctrl+Space` (Windows/Linux) |

Tests use [Vitest](https://vitest.dev/). `npm run build` (TypeScript strict mode) and `npm run test` must both pass. Main process changes require full restart; renderer changes hot-reload.

## Architecture (3-Layer)

```
Renderer (React 19 + Zustand 5 + Tailwind CSS 4 + Framer Motion)
    ↕  contextBridge IPC (src/preload/index.ts)
Main Process (Node.js / Electron 33)
    ↕  spawns subprocess
Claude Code CLI (claude -p --output-format stream-json)
```

### Data Flow: Prompt → Response

```
InputBar → window.clui.prompt(tabId, requestId, opts)
  → ipcRenderer.invoke('clui:prompt')
  → ControlPlane.prompt()
  → RunManager spawns: claude -p --output-format stream-json --resume <sid>
  → stdout NDJSON → StreamParser → EventNormalizer → NormalizedEvent
  → ControlPlane broadcasts via IPC
  → useClaudeEvents hook → sessionStore.handleNormalizedEvent()
  → React re-renders
```

### Key Files by Concern

| Concern | File |
|---------|------|
| Tab lifecycle & state machine | `src/main/claude/control-plane.ts` |
| Spawning Claude CLI processes | `src/main/claude/run-manager.ts` |
| Raw NDJSON → canonical events | `src/main/claude/event-normalizer.ts` |
| Permission hook HTTP server | `src/main/hooks/permission-server.ts` |
| All types & IPC channel names | `src/shared/types.ts` |
| Session state store | `src/renderer/stores/sessionStore.ts` |
| Notification store (toasts) | `src/renderer/stores/notificationStore.ts` |
| Command palette store | `src/renderer/stores/commandPaletteStore.ts` |
| Comparison store (multi-model) | `src/renderer/stores/comparisonStore.ts` |
| Workflow store | `src/renderer/stores/workflowStore.ts` |
| Tab group store | `src/renderer/stores/tabGroupStore.ts` |
| Snippet store | `src/renderer/stores/snippetStore.ts` |
| Shortcut store | `src/renderer/stores/shortcutStore.ts` |
| Export store | `src/renderer/stores/exportStore.ts` |
| Tab ordering | `src/renderer/stores/tabOrder.ts` |
| Cost tracking | `src/main/cost-tracker.ts` |
| Git context | `src/main/git-context.ts` |
| Auto-attach config | `src/main/auto-attach.ts` |
| Diff algorithm | `src/renderer/utils/diff.ts` |
| Keyboard shortcuts | `src/shared/keyboard-shortcuts.ts` |
| Session export logic | `src/shared/session-export.ts` |
| Command palette definitions | `src/shared/command-palette.ts` |
| Theme / color system | `src/renderer/theme.ts` |
| Window creation & IPC handlers | `src/main/index.ts` |
| Typed IPC bridge | `src/preload/index.ts` |
| Marketplace catalog | `src/main/marketplace/catalog.ts` |
| Linux platform support | `src/main/linux-support.ts` |
| Terminal launch detection | `src/main/terminal-launch.ts` |
| Screenshot capture | `src/main/screenshot.ts` |

## Conventions

- **TypeScript strict mode** — zero errors required, `npm run build` must pass.
- **`IPC.*` constants** for all IPC channel names (defined in `src/shared/types.ts`) — never hardcode strings.
- **`useColors()` hook** for all color references in renderer — never hardcode color values.
- **Narrow Zustand selectors** with custom equality functions to prevent re-renders during streaming.
- **Phosphor icons** (`@phosphor-icons/react`) — no other icon libraries.
- **Framer Motion** for animations.
- **Tab state transitions** go through ControlPlane only — never mutate tab state from renderer.
- Do not import main-process modules from renderer or vice versa — preload bridge is the only crossing point.
- Do not use `node-pty` for new features — it's legacy; prefer `RunManager` (stdio-based).
- Do not add network calls — the app is nearly offline (only marketplace fetches from GitHub).
- Do not use Electron `remote` module — disabled for security.

## Linux-Specific Conventions

- **Wayland detection** — use `isWaylandSession()` from `src/main/linux-support.ts` instead of checking env vars directly.
- **Click-through disabled on Wayland** — `setIgnoreMouseEvents({ forward: true })` breaks on Wayland compositors (makes window unclickable). The app disables click-through on Wayland sessions.
- **Global shortcut fallback** — use `registerGlobalShortcutSafe()` which catches Wayland failures gracefully instead of crashing.
- **Terminal detection** — `detectLinuxTerminal()` in `src/main/terminal-launch.ts` auto-discovers installed terminals (Konsole, Alacritty, Kitty, gnome-terminal, xfce4-terminal, wezterm, xterm) with per-terminal exec flag syntax.
- **Screenshot tools** — `getLinuxScreenshotTool()` in `src/main/screenshot.ts` detects available tools (spectacle, gnome-screenshot, flameshot, scrot, grim) with Wayland-awareness (skips X11-only tools on Wayland, and vice versa).
- **Fish shell** — detected and supported for environment variable passthrough.
- **Tray icon** — GNOME requires the AppIndicator extension; the app provides a fallback path.
- **`@tailwindcss/oxide-linux-x64-gnu`** is listed in `optionalDependencies` for Linux native builds.

## Security Rules — Do Not Break

- Permission server binds to `127.0.0.1` only (never `0.0.0.0`).
- Per-launch app secret (random UUID) validates hook requests.
- Per-run tokens route permission responses to correct tab.
- `CLAUDECODE` env var is removed from spawned processes.
- Sensitive fields masked via `maskSensitiveFields()` before display.
- 5-minute auto-deny timeout on unanswered permissions.
- **`sed`, `awk`, `xargs` removed from `SAFE_BASH_COMMANDS`** — these can be abused for command injection.
- **Subshell injection detection** in `isSafeBashCommand()` — rejects commands containing `$(...)` or backtick subshells.

## Adding Features — Wiring Checklist

**New IPC channel:** Add to `IPC` const in `src/shared/types.ts` → handler in `src/main/index.ts` → expose in `src/preload/index.ts` → call via `window.clui.*`.

**New event type from CLI:** Add raw type to `ClaudeEvent` union in `src/shared/types.ts` → add normalized form to `NormalizedEvent` → handle in `EventNormalizer.normalize()` → handle in `sessionStore.handleNormalizedEvent()`.

**New tab state field:** Add to `TabState` in `src/shared/types.ts` → initialize in `createTab()` in both ControlPlane and sessionStore → update only via ControlPlane events.

**New platform feature:** Add platform detection in the relevant module → gate with `process.platform` check → add tests in `tests/unit/` (TDD: write failing test first) → update the platform-specific docs (`docs/LINUX.md`, `docs/WINDOWS.md`).

## Development Approach

- **TDD (test-driven development)** is used for new features — write failing tests first, then implement. Tests live in `tests/unit/` and use Vitest.
- **E2E smoke tests** cover critical user flows (see `tests/e2e/smoke.spec.ts`). 12 E2E test issues are tracked (#244-#255).

## Debugging Protocol — MANDATORY

When the user reports a bug, error, or broken behavior, you MUST follow this sequence BEFORE attempting any fix:

1. **`git log --oneline -10`** — check what changed recently. Most bugs come from recent commits.
2. **Read the changed files** — `git show <hash> --stat` then `git show <hash> -- <file>` for suspicious changes.
3. **Reproduce the issue** — read the relevant source code, trace the data flow, identify the root cause.
4. **Check `~/.clui-debug.log`** — if the app was run with `CLUI_DEBUG=1`, the log has IPC traces and error details.
5. **Only THEN propose a fix** — with an explanation of the root cause.

**DO NOT skip to "let me try fixing this" without completing steps 1-3.** Guessing at fixes without investigation wastes time and often introduces new bugs. The git history and source code have the answers — use them.

## Error Handling Rules

- **Never use empty `catch {}` blocks.** Always log the error: `catch (err) { console.warn('[module] operation failed:', err) }`.
- **Silent failures are bugs.** If an operation can fail, the failure must be visible in logs or UI.
- **Addon/plugin loading must be logged.** When loading optional features (xterm addons, etc.), log both success and failure so debugging is possible.

## Common Pitfalls

- Forgetting to restart dev server after main-process changes (renderer hot-reloads, main does not).
- Adding raw color values instead of `useColors()` — breaks theming.
- Mutating tab state from renderer instead of going through ControlPlane.
- Not handling `session_dead` event — crashed Claude processes must transition tab to `dead` status.
- Using `catch {}` (empty catch) — hides errors and makes debugging impossible. Always log.
- Not checking `git log` before debugging — recent commits are the #1 source of new bugs.
- Calling `getTabState()` in Zustand selectors — creates new objects each render, causes infinite re-render loops. Read directly from the Map: `s.tabStates.get(id)?.field ?? default`.
- Mutating tool call event objects in-place — use spread/clone to avoid corrupting shared state.
- Not null-guarding `RunManager.cancel()` — the run reference may already be null.
- Emitting `tool_call_complete` for non-tool `content_block_stop` indices — check that the index maps to a tool block.
- Testing on X11 only — Wayland has different behavior for shortcuts, click-through, and screenshots.
