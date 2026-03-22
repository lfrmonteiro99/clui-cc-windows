# Implementation Plan: Window Customization & UX Improvements

7 features grouped into 4 implementation phases.

---

## Phase 1: Settings Infrastructure (foundation for all features)

### 1.1 — Create a unified `WindowSettingsStore` (renderer)

**File:** `src/renderer/stores/windowSettingsStore.ts`

Add a new Zustand store persisted to `localStorage('clui-window-settings')`:

```ts
interface WindowSettings {
  opacity: number            // 0.3–1.0, default 1.0
  expandedUI: boolean        // persisted (currently resets on launch)
  draggable: boolean         // default true
  projectColors: Record<string, string>  // projectPath → hex color
}
```

- `expandedUI` moves here from `useThemeStore` and is **no longer reset on launch** (fixes the "full width doesn't stick" bug).
- `opacity` will be sent to main process via new IPC channel.
- `projectColors` maps encoded project paths to user-chosen accent colors.

### 1.2 — New IPC channels in `src/shared/types.ts`

Add to the `IPC` const:
- `SET_OPACITY = 'clui:set-opacity'` — renderer → main, payload `{ opacity: number }`
- `SET_DRAGGABLE = 'clui:set-draggable'` — renderer → main, payload `{ draggable: boolean }`
- `GET_WINDOW_SETTINGS = 'clui:get-window-settings'` — main → renderer sync on launch
- `SET_TOGGLE_SHORTCUT = 'clui:set-toggle-shortcut'` — renderer → main, payload `{ shortcut: string }`
- `SET_ALWAYS_ON_TOP_LOG = 'clui:set-log-level'` — renderer → main, payload `{ level: string }`

### 1.3 — Expose in preload (`src/preload/index.ts`)

Wire each new IPC channel through `contextBridge`.

---

## Phase 2: Window Behavior Features

### 2.1 — Adjustable Transparency / Opacity

**Main process** (`src/main/index.ts`):
- Handle `SET_OPACITY`: call `mainWindow.setOpacity(value)` (Electron native API).
- On window creation, read saved opacity from a new file `~/.claude/clui-window.json` and apply.
- Persist opacity changes to `~/.claude/clui-window.json`.

**Renderer** (`windowSettingsStore`):
- Slider in settings panel (0.3–1.0 range, step 0.05).
- On change, call `window.clui.setOpacity(value)`.

### 2.2 — Draggable Overlay

**Main process** (`src/main/index.ts`):
- Currently `setIgnoreMouseEvents(true, { forward: true })` is used for click-through on transparent regions.
- Add handler for `SET_DRAGGABLE`.
- When draggable is enabled, the renderer will use `-webkit-app-region: drag` on a designated drag handle area (top bar of the pill UI).

**Renderer**:
- Add a drag handle bar (thin strip at top of the container) with CSS `-webkit-app-region: drag`.
- Interactive elements inside must have `-webkit-app-region: no-drag`.
- Position is remembered per-session (stored in `~/.claude/clui-window.json`).

### 2.3 — Full Width Persistence (bug fix)

**Current bug:** `expandedUI` is reset to `false` in `useThemeStore.persist.onRehydrate` or initialization.

**Fix:**
- In `src/renderer/theme.ts`, remove the forced `expandedUI: false` on launch.
- Move `expandedUI` persistence to `windowSettingsStore` so it survives restarts.
- On launch, read saved value and apply — the native window is already 1040px so expanded CSS just works.

---

## Phase 3: Project Colors & Customization

### 3.1 — Project Color Association

**Store:** `windowSettingsStore.projectColors`

**Renderer UI** (settings panel or tab context menu):
- Color picker (small palette of 8–10 preset colors + custom hex input).
- When a project has an assigned color, apply it as:
  - Tab indicator border/underline color.
  - Subtle tint on the container background (e.g., 5% opacity overlay).
  - Session list badge color.

**Implementation:**
- Add `getProjectColor(projectPath: string): string | undefined` selector.
- Add `setProjectColor(projectPath: string, color: string)` action.
- In tab components, read active tab's `projectPath`, look up color, apply as inline style or CSS variable override.
- Use a new CSS variable `--clui-project-accent` that defaults to the theme accent but can be overridden per-project.

### 3.2 — Wider Format for Larger Screens

**Current state:** Native window is hardcoded at 1040×720.

**Change:**
- Make `BAR_WIDTH` dynamic based on screen size:
  - Screens ≤ 1440px wide → 1040px (current)
  - Screens 1441–1920px → 1280px
  - Screens > 1920px → 1600px
- Store user preference in `~/.claude/clui-window.json`: `{ widthMode: 'auto' | 'compact' | 'wide' | 'ultrawide' }`.
- On display change (monitor switch), recalculate.
- Renderer expanded mode uses full available width within the native window.

---

## Phase 4: System Features

### 4.1 — Customizable Toggle Shortcut (from renderer UI)

**Current state:** Shortcut is in `~/.claude/clui-shortcut.json`, changeable only by editing the file.

**Add to settings UI:**
- A "Record shortcut" button in the Settings panel (Keyboard section).
- On click, capture next key combination (like shortcut recording in OS preferences).
- Validate: must include a modifier (Ctrl/Alt/Cmd/Shift) + a key.
- Send to main via `SET_TOGGLE_SHORTCUT` IPC.
- Main process: unregister old shortcut, register new one, persist to `~/.claude/clui-shortcut.json`.
- Show current shortcut and fallback info.

**File:** Add a new shortcut action `toggle-overlay` to `src/shared/keyboard-shortcuts.ts` with special handling (it's a global shortcut, not an in-app one).

### 4.2 — Always-On Logging (not just CLUI_DEBUG)

**Current state:** Logging only works with `CLUI_DEBUG=1` env var. No logs in production.

**Changes to `src/main/logger.ts`:**
- Always write logs (not gated by `CLUI_DEBUG`), but at different levels:
  - **Default level (`info`):** App lifecycle events (start, quit, crash), permission requests, session start/stop, errors, window show/hide.
  - **Debug level (`debug`):** Everything currently logged — CLI output parsing, IPC traffic, etc.
- `CLUI_DEBUG=1` sets level to `debug`; otherwise default is `info`.
- Add log rotation: keep last 3 files, max 5 MB each.
  - Files: `~/.clui.log`, `~/.clui.log.1`, `~/.clui.log.2`
- Add IPC channel to retrieve log file path for "Copy log path" button in settings.
- Add a "Diagnostics" section in settings UI showing:
  - Log file location (clickable to open in Finder/Explorer).
  - Current log level toggle (info/debug).
  - "Export logs" button (copies last 1000 lines to clipboard).

---

## File Change Summary

| File | Changes |
|------|---------|
| `src/shared/types.ts` | New IPC channels (5) |
| `src/preload/index.ts` | Expose new IPC methods |
| `src/main/index.ts` | IPC handlers for opacity, draggable, shortcut, window size; dynamic BAR_WIDTH; drag position persistence |
| `src/main/logger.ts` | Always-on logging, log levels, rotation |
| `src/main/shortcut-config.ts` | API to update shortcut at runtime |
| `src/main/window-config.ts` | Dynamic width support |
| `src/renderer/stores/windowSettingsStore.ts` | **New file** — opacity, expandedUI, draggable, projectColors, widthMode |
| `src/renderer/theme.ts` | Remove `expandedUI` reset; delegate to windowSettingsStore |
| `src/renderer/components/Settings*.tsx` | New sections: Appearance (opacity slider, width mode), Projects (color picker), Keyboard (toggle shortcut recorder), Diagnostics (log viewer) |
| `src/shared/keyboard-shortcuts.ts` | Add `toggle-overlay` action type |
| Tab/session components | Read project color, apply `--clui-project-accent` |

---

## Implementation Order

1. **Phase 1** first (settings infra) — everything else depends on it.
2. **Phase 2.3** (full width bug fix) — smallest, highest user impact.
3. **Phase 2.1 + 2.2** (opacity + drag) — closely related window behavior.
4. **Phase 4.2** (logging) — independent, high diagnostic value.
5. **Phase 3.1** (project colors) — UI-heavy, independent.
6. **Phase 3.2** (wider format) — needs testing across display sizes.
7. **Phase 4.1** (toggle shortcut UI) — nice-to-have, lower priority.

## Testing Strategy

- Unit tests for `windowSettingsStore` (persistence, defaults, validation).
- Unit tests for log rotation logic.
- Unit tests for dynamic width calculation.
- Integration: verify IPC round-trip for opacity/draggable/shortcut.
- Manual: test drag behavior with click-through regions, test opacity on Windows (GPU compositor edge cases).
