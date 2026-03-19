# File Peek — Design Specification

**Date:** 2026-03-19
**Branch:** Feature branch TBD
**Status:** Design complete, ready for implementation

---

## 1. Overview & Goals

File Peek adds read-only file viewing directly inside Clui CC. When Claude references a file path (in tool results, diffs, or markdown), the user can Ctrl+Click to open a syntax-highlighted preview panel, or right-click for a context menu with additional actions.

**Goals:**
- Quick, in-app file inspection without leaving the overlay (read-only)
- VS Code-quality syntax highlighting via Shiki
- Architecture prepared for future inline editing (store shape, IPC design)

**Non-goals for v1:**
- File editing, save-back, or undo/redo
- File tree browsing or navigation between files
- Search within file content

---

## 2. Architecture

### 2.1 New Files

| File | Layer | Responsibility |
|------|-------|----------------|
| `src/renderer/stores/filePeekStore.ts` | Renderer | Zustand store for peek panel state (open, filePath, content, loading, error, language) |
| `src/renderer/stores/contextMenuStore.ts` | Renderer | Zustand store for custom context menu state (open, position, filePath, items) |
| `src/renderer/components/FilePath.tsx` | Renderer | Shared wrapper component for all file path references — handles Ctrl+Click and onContextMenu |
| `src/renderer/components/FileContextMenu.tsx` | Renderer | Custom right-click menu (glass-surface, 4 options, keyboard navigable) |
| `src/renderer/components/FilePeekPanel.tsx` | Renderer | Above-card panel with Shiki-highlighted code, header, line numbers |

### 2.2 Modified Files

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `IPC.FILE_READ`, `IPC.FILE_REVEAL`, `IPC.FILE_OPEN_EXTERNAL` constants |
| `src/main/index.ts` | Add IPC handlers for the three new channels |
| `src/preload/index.ts` | Expose `fileRead()`, `fileReveal()`, `fileOpenExternal()` on `CluiAPI` |
| `src/renderer/App.tsx` | Mount `<FilePeekPanel>` and `<FileContextMenu>` in the panel stack |
| `src/renderer/components/ConversationView.tsx` | Use `<FilePath>` in tool summaries (Read/Edit/Write/Glob descriptions), and add custom `code` renderer to Markdown |
| `src/renderer/components/DiffViewer.tsx` | Wrap the file name in the header with `<FilePath>` |

### 2.3 Integration with Existing Architecture

```
User Ctrl+Clicks file path in ConversationView
  -> <FilePath> calls filePeekStore.openPeek(path)
  -> filePeekStore calls window.clui.fileRead(tabWorkingDir, path)
  -> ipcRenderer.invoke(IPC.FILE_READ, { workingDirectory, filePath })
  -> main process validates path is under workingDirectory
  -> main process reads file (max 100KB / 5000 lines)
  -> returns { content, language, lineCount, truncated }
  -> filePeekStore updates state -> FilePeekPanel renders
```

---

## 3. New IPC Channels

### 3.1 `IPC.FILE_READ`

Add to the IPC constant object in `src/shared/types.ts` (line 461, inside the `IPC` const):

```typescript
// File peek
FILE_READ: 'clui:file-read',
FILE_REVEAL: 'clui:file-reveal',
FILE_OPEN_EXTERNAL: 'clui:file-open-external',
```

**Channel:** `clui:file-read`
**Direction:** renderer -> main (invoke/handle)
**Request payload:**

```typescript
{
  workingDirectory: string  // tab's workingDirectory (security boundary)
  filePath: string          // absolute or relative path
}
```

**Response payload:**

```typescript
{
  ok: true
  content: string
  language: string          // derived from file extension (e.g. 'typescript', 'python')
  lineCount: number
  truncated: boolean        // true if file exceeded 100KB or 5000 lines
  fileSize: number          // original file size in bytes
}
| {
  ok: false
  error: 'not_found' | 'too_large' | 'binary' | 'permission_denied' | 'outside_workspace'
  message: string
}
```

**Main process handler logic (in `src/main/index.ts`):**

1. Resolve `filePath` to absolute (if relative, resolve against `workingDirectory`)
2. Normalize the resolved path (resolve `..`, symlinks)
3. **Security check:** verify the resolved absolute path starts with `workingDirectory` (path traversal prevention)
4. Check file exists (`existsSync`)
5. Check file size (`statSync`) — reject if > 100KB with `too_large` error
6. Read first 8KB and check for null bytes (binary detection) — reject with `binary` error
7. Read full file content (`readFileSync('utf-8')`)
8. If line count > 5000, truncate to 5000 lines and set `truncated: true`
9. Derive language from file extension using a static map
10. Return success payload

### 3.2 `IPC.FILE_REVEAL`

**Channel:** `clui:file-reveal`
**Direction:** renderer -> main (invoke/handle)
**Payload:** `{ filePath: string, workingDirectory: string }`
**Handler:** `shell.showItemInFolder(resolvedPath)` — Electron built-in, opens OS file explorer with the file selected.
**Security:** Same workspace boundary check as FILE_READ — `workingDirectory` is required in the payload.

### 3.3 `IPC.FILE_OPEN_EXTERNAL`

**Channel:** `clui:file-open-external`
**Direction:** renderer -> main (invoke/handle)
**Payload:** `{ filePath: string, workingDirectory: string }`
**Handler:** `shell.openPath(resolvedPath)` — Opens file in the OS default editor.
**Security:** Same workspace boundary check as FILE_READ — `workingDirectory` is required in the payload.

### 3.4 Language Detection Map

Static map in the main process handler (no dependency needed):

```typescript
const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
  '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
  '.cs': 'csharp', '.rb': 'ruby', '.php': 'php', '.swift': 'swift',
  '.kt': 'kotlin', '.scala': 'scala', '.lua': 'lua', '.r': 'r',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'fish',
  '.ps1': 'powershell', '.bat': 'batch',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.xml': 'xml', '.html': 'html', '.css': 'css', '.scss': 'scss',
  '.less': 'less', '.sql': 'sql', '.graphql': 'graphql',
  '.md': 'markdown', '.mdx': 'mdx', '.txt': 'plaintext',
  '.dockerfile': 'dockerfile', '.prisma': 'prisma',
  '.vue': 'vue', '.svelte': 'svelte', '.astro': 'astro',
  '.env': 'dotenv', '.ini': 'ini', '.cfg': 'ini',
  '.lock': 'plaintext', '.log': 'plaintext',
}
```

Files with no extension or unrecognized extensions default to `'plaintext'`.

---

## 4. State Management

### 4.1 `filePeekStore.ts`

```typescript
import { create } from 'zustand'

interface FilePeekState {
  // Panel state
  isOpen: boolean
  filePath: string | null         // absolute path being viewed
  displayPath: string | null      // shortened for display (relative to working dir)
  content: string | null
  language: string | null
  lineCount: number
  truncated: boolean
  fileSize: number
  loading: boolean
  error: string | null
  errorType: 'not_found' | 'too_large' | 'binary' | 'permission_denied' | 'outside_workspace' | null

  // Actions
  openPeek: (filePath: string, workingDirectory: string) => Promise<void>
  closePeek: () => void
}

export const useFilePeekStore = create<FilePeekState>((set, get) => ({
  isOpen: false,
  filePath: null,
  displayPath: null,
  content: null,
  language: null,
  lineCount: 0,
  truncated: false,
  fileSize: 0,
  loading: false,
  error: null,
  errorType: null,

  openPeek: async (filePath, workingDirectory) => {
    // If same file is already open, just ensure panel is visible
    if (get().filePath === filePath && get().isOpen && !get().error) return

    set({
      isOpen: true,
      filePath,
      displayPath: filePath.startsWith(workingDirectory)
        ? filePath.slice(workingDirectory.length + 1)
        : filePath,
      content: null,
      language: null,
      lineCount: 0,
      truncated: false,
      fileSize: 0,
      loading: true,
      error: null,
      errorType: null,
    })

    try {
      const result = await window.clui.fileRead(workingDirectory, filePath)
      if (result.ok) {
        set({
          content: result.content,
          language: result.language,
          lineCount: result.lineCount,
          truncated: result.truncated,
          fileSize: result.fileSize,
          loading: false,
        })
      } else {
        set({
          loading: false,
          error: result.message,
          errorType: result.error,
        })
      }
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to read file',
        errorType: null,
      })
    }
  },

  closePeek: () => set({
    isOpen: false,
    // Keep filePath/content cached so AnimatePresence exit animation
    // doesn't flash empty content
  }),
}))
```

**Future edit-mode additions** (not implemented in v1, but the shape accommodates them):

```typescript
// These fields would be added when implementing edit mode:
dirtyContent: string | null     // edited but unsaved content
isDirty: boolean                // content !== dirtyContent
undoStack: string[]             // for Ctrl+Z
redoStack: string[]             // for Ctrl+Shift+Z
saveFile: () => Promise<void>   // calls IPC.FILE_WRITE (future)
```

### 4.2 `contextMenuStore.ts`

```typescript
import { create } from 'zustand'

export interface ContextMenuItem {
  id: string
  label: string
  icon: string          // Phosphor icon name (resolved in component)
  shortcut?: string     // display hint like 'Ctrl+Click'
  disabled?: boolean
  danger?: boolean
}

interface ContextMenuState {
  isOpen: boolean
  position: { x: number; y: number }
  filePath: string | null
  workingDirectory: string | null
  items: ContextMenuItem[]
  focusedIndex: number

  // Actions
  openMenu: (position: { x: number; y: number }, filePath: string, workingDirectory: string) => void
  closeMenu: () => void
  setFocusedIndex: (index: number) => void
}

const FILE_CONTEXT_ITEMS: ContextMenuItem[] = [
  { id: 'peek', label: 'Peek File', icon: 'Eye', shortcut: 'Ctrl+Click' },
  { id: 'copy-path', label: 'Copy Path', icon: 'Copy' },
  { id: 'reveal', label: process.platform === 'darwin' ? 'Reveal in Finder' : 'Reveal in Explorer', icon: 'FolderOpen' },
  { id: 'open-external', label: 'Open in Editor', icon: 'ArrowSquareOut' },
]

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  isOpen: false,
  position: { x: 0, y: 0 },
  filePath: null,
  workingDirectory: null,
  items: FILE_CONTEXT_ITEMS,
  focusedIndex: -1,

  openMenu: (position, filePath, workingDirectory) => set({
    isOpen: true,
    position,
    filePath,
    workingDirectory,
    items: FILE_CONTEXT_ITEMS,
    focusedIndex: -1,
  }),

  closeMenu: () => set({
    isOpen: false,
    focusedIndex: -1,
  }),

  setFocusedIndex: (index) => set({ focusedIndex: index }),
}))
```

---

## 5. Components

### 5.1 `<FilePath>`

**File:** `src/renderer/components/FilePath.tsx`

Shared wrapper for all file path text in the UI. Renders as an inline `<span>` with hover underline styling. Handles Ctrl+Click (open peek) and right-click (open context menu).

```typescript
interface FilePathProps {
  path: string                    // the file path string
  displayName?: string            // optional shortened display (e.g. just filename)
  className?: string
  style?: React.CSSProperties
}
```

**Behavior:**
- `onClick` with `e.ctrlKey` (or `e.metaKey` on Mac): calls `filePeekStore.openPeek(path, workingDirectory)` where `workingDirectory` comes from `useSessionStore` (active tab's `workingDirectory`)
- `onClick` without modifier: no-op (normal text selection)
- `onContextMenu`: calls `e.preventDefault()`, then `contextMenuStore.openMenu({ x: e.clientX, y: e.clientY }, path, workingDirectory)`
- Hover style: underline, cursor pointer, color `colors.accent`

**Accessibility:**
- `role="button"` with `aria-label="Peek file {path}"`
- `title` attribute showing full path
- Responds to Enter key (same as Ctrl+Click)

### 5.2 `<FileContextMenu>`

**File:** `src/renderer/components/FileContextMenu.tsx`

Custom React context menu. Mounted at the App level (portal or direct child of App root). Positioned absolutely at `contextMenuStore.position`. **Must have `data-clui-ui` attribute** on the root element — without it, the app's click-through system (`setIgnoreMouseEvents`) will swallow clicks on the menu.

**Visual design:**
- `glass-surface` class (matches existing panels)
- `border-radius: 12px`
- `box-shadow`: `colors.popoverShadow`
- `background`: `colors.popoverBg`
- `border`: `1px solid ${colors.popoverBorder}`
- `min-width: 200px`
- `z-index: 40` (above all panels)
- Each item: 32px height, 12px horizontal padding, `fontSize: 12`, `gap: 8` between icon and label
- Hovered item: `background: colors.surfaceHover`
- Phosphor icons at `size={14}` to the left of each label
- Shortcut hint (e.g. "Ctrl+Click") right-aligned in `colors.textTertiary`

**Keyboard navigation:**
- `ArrowDown` / `ArrowUp`: move `focusedIndex`
- `Enter`: execute focused item
- `Escape`: close menu

**Dismissal:**
- Click outside (use `useEffect` with `mousedown` listener on `document`)
- `Escape` key
- After executing any item

**Item actions (dispatched from FileContextMenu):**
| Item ID | Action |
|---------|--------|
| `peek` | `filePeekStore.openPeek(filePath, workingDirectory)` |
| `copy-path` | `navigator.clipboard.writeText(filePath)` + toast notification |
| `reveal` | `window.clui.fileReveal(filePath, workingDirectory)` |
| `open-external` | `window.clui.fileOpenExternal(filePath, workingDirectory)` |

### 5.3 `<FilePeekPanel>`

**File:** `src/renderer/components/FilePeekPanel.tsx`

Above-card panel, same mounting pattern as `MarketplacePanel` / `CostDashboard` in `App.tsx`.

**Layout (matches existing panel pattern from `App.tsx` lines 306-338):**
- Container: `width: 720`, `maxWidth: 720`, `marginLeft: 50%`, `transform: translateX(-50%)`, `marginBottom: 14`, `position: relative`, `zIndex: 32`
- AnimatePresence wrapper with `initial={{ opacity: 0, y: 14, scale: 0.98 }}`, `animate={{ opacity: 1, y: 0, scale: 1 }}`, `exit={{ opacity: 0, y: 10, scale: 0.985 }}`
- Inner: `glass-surface overflow-hidden no-drag`, `borderRadius: 24`, `maxHeight: 470`

**Panel structure:**

```
+-------------------------------------------------------+
| Header                                                 |
| [FileIcon] src/renderer/stores/sessionStore.ts  [X]   |
| TypeScript  |  1,247 lines  |  48.2 KB                |
+-------------------------------------------------------+
| Line numbers | Syntax-highlighted code                 |
| 1            | import { create } from 'zustand'        |
| 2            |                                         |
| ...          | (scrollable, max-height ~400px)         |
+-------------------------------------------------------+
| Footer (only if truncated)                             |
| File truncated at 5,000 lines (showing 100KB of 1.2MB)|
+-------------------------------------------------------+
```

**Header:**
- Height: ~48px
- Left: Phosphor `FileText` icon (size 16) + display path (truncated with ellipsis, `title` = full path)
- Right: `X` button to close (`filePeekStore.closePeek()`)
- Below path: language badge + line count + file size, in `colors.textTertiary`, `fontSize: 11`
- `borderBottom: 1px solid ${colors.containerBorder}`

**Code area:**
- `overflow-y: auto`, `max-height: 400px`
- `scrollbar-width: thin` (Firefox) + webkit scrollbar styles
- Background: `colors.codeBg`
- Line number gutter: `width: 5ch`, `text-align: right`, `color: colors.textMuted`, `user-select: none`, `padding-right: 12px`
- Code content: Shiki-rendered HTML, `font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`, `fontSize: 12`, `line-height: 20px`
- Horizontal overflow: `overflow-x: auto` on inner container

**Truncation footer (conditional):**
- Only shown when `filePeekStore.truncated === true`
- `padding: 6px 16px`, `fontSize: 11`, `color: colors.textTertiary`
- `borderTop: 1px solid ${colors.containerBorder}`
- Text: "File truncated at 5,000 lines (showing 100KB of {fileSize})"

**Loading state:**
- Skeleton lines (3-4 pulsing bars, same pattern as MarketplacePanel's `LoadingState` at line 713)
- Shown while `filePeekStore.loading === true`

**Error state:**
- Icon + message centered in the code area
- `not_found`: "File not found — it may have been moved or deleted since Claude referenced it."
- `too_large`: "File is too large to preview ({fileSize}). Maximum: 100KB."
- `binary`: "Binary file — cannot display preview."
- `permission_denied`: "Permission denied — cannot read this file."
- `outside_workspace`: "File is outside the current workspace."

### 5.4 Integration into ConversationView

Three integration points in `src/renderer/components/ConversationView.tsx`:

**A. Tool summaries (getToolDescription function, line 641)**

The `getToolDescription` function already extracts `parsed.file_path` for Read, Edit, Write tools. The `ToolGroup` component renders these descriptions as plain text. Modify the tool description rendering (inside the `<span>` at line 729) to detect file paths and wrap them with `<FilePath>`.

Specifically, in the tool timeline (line 724-730), change the description span to parse and wrap any file path segment:

```tsx
// Before:
<span className="text-[12px] leading-[1.4] block truncate" ...>
  {desc}
</span>

// After:
<span className="text-[12px] leading-[1.4] block truncate" ...>
  <ToolDescriptionWithFilePath desc={desc} toolInput={parsed} />
</span>
```

Where `ToolDescriptionWithFilePath` extracts the `file_path` from the tool input (if present) and wraps just that portion with `<FilePath>`.

**B. DiffViewer header (line 95-105 in DiffViewer.tsx)**

Wrap the `{fileName}` span inside the DiffViewer header button with `<FilePath>`:

```tsx
// Before:
<span style={{...}} title={filePath}>
  {fileName}
</span>

// After:
<FilePath path={filePath} displayName={fileName} />
```

Note: The `<FilePath>` click handler must call `e.stopPropagation()` to prevent toggling the diff collapse when Ctrl+Clicking or right-clicking the file name.

**C. Markdown inline code (AssistantMessage, line 578)**

Add a custom `code` component to the `markdownComponents` object (line 578 in ConversationView.tsx) that detects file path patterns inside inline code blocks:

```typescript
code: ({ children, className }: any) => {
  // Only for inline code (no className means not a fenced code block)
  if (className) {
    // Fenced code block — render normally
    return <code className={className}>{children}</code>
  }

  const text = typeof children === 'string' ? children : String(children ?? '')

  // Check if it looks like a file path
  if (isLikelyFilePath(text)) {
    return <FilePath path={text} displayName={text} />
  }

  return <code>{children}</code>
}
```

---

## 6. File Path Detection

### 6.1 Already-Parsed Paths (Tool Results & DiffViewer)

These paths are already parsed from structured JSON data — no regex needed:

- **Tool results:** `toolInput.file_path` is extracted in `parseToolInput()` (ConversationView.tsx line 852) for Read, Edit, Write, Glob tools. These are reliable absolute or relative paths.
- **DiffViewer:** The `filePath` prop is passed directly from tool input parsing (ConversationView.tsx line 872, 887).

### 6.2 Markdown Path Detection (Inline Code Only)

For assistant markdown text, file paths are detected only inside backtick-delimited inline code elements. This is a deliberate constraint to minimize false positives — file paths in prose text are too ambiguous (e.g. "use the src/utils approach" could be prose, not a path).

**Detection function:**

```typescript
function isLikelyFilePath(text: string): boolean {
  // Must contain at least one path separator
  if (!text.includes('/') && !text.includes('\\')) return false

  // Must not be a URL
  if (/^https?:\/\//i.test(text)) return false

  // Must not be just a bare protocol or domain
  if (text.includes('://')) return false

  // Must contain a file extension (at least 1-6 chars after last dot)
  // OR be a well-known extensionless file (Makefile, Dockerfile, etc.)
  const KNOWN_EXTENSIONLESS = new Set([
    'Makefile', 'Dockerfile', 'Vagrantfile', 'Gemfile',
    'Rakefile', 'Procfile', 'Brewfile',
  ])
  const basename = text.split(/[/\\]/).pop() || ''
  if (KNOWN_EXTENSIONLESS.has(basename)) return true

  // Check for file extension pattern
  if (!/\.\w{1,6}$/.test(text)) return false

  // Reject if it looks like a version string (e.g. v2.1.63)
  if (/^v?\d+\.\d+/.test(text)) return false

  // Reject if it looks like a floating point number
  if (/^\d+\.\d+$/.test(text)) return false

  return true
}
```

**What matches:**
- `src/renderer/App.tsx`
- `./utils/diff.ts`
- `C:\Users\foo\project\file.ts`
- `../shared/types.ts`
- `package.json`  — No, this has no separator. Only matches inside code blocks that have a `/` or `\`.
- `/etc/nginx/nginx.conf`
- `src/Makefile`

**What does NOT match:**
- `https://example.com/path/to/file.ts` (URL)
- `v2.1.63` (version string)
- `3.14` (number)
- `some/random/text` (no file extension)
- `Hello World` (no separator, no extension)

### 6.3 Edge Case: Relative Paths

File paths from tool results are often relative to the working directory. The `<FilePath>` component always passes the path as-is to the store, which passes it to the IPC handler. The main process handler resolves relative paths against the tab's `workingDirectory` before reading.

---

## 7. Interaction Design

### 7.1 Ctrl+Click Flow

1. User holds Ctrl (or Cmd on Mac) and clicks a file path
2. `<FilePath>.onClick` fires, detects modifier key
3. Calls `filePeekStore.openPeek(path, workingDirectory)`
4. Store sets `loading: true`, `isOpen: true`
5. Store calls `window.clui.fileRead(workingDirectory, path)`
6. Main process reads file, returns content
7. Store updates `content`, `language`, `lineCount`
8. `<FilePeekPanel>` renders with Shiki-highlighted code
9. If another file is Ctrl+Clicked while peek is open, the new file replaces the current one (no stacking)

### 7.2 Right-Click Flow

1. User right-clicks a file path
2. `<FilePath>.onContextMenu` fires, calls `e.preventDefault()`
3. Calls `contextMenuStore.openMenu({ x: e.clientX, y: e.clientY }, path, workingDirectory)`
4. `<FileContextMenu>` renders at the cursor position
5. User clicks an item or navigates with arrow keys + Enter
6. Item action dispatches (see section 5.2)
7. Menu closes

### 7.3 Keyboard Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| `Escape` | Peek panel open | Close peek panel |
| `Escape` | Context menu open | Close context menu |
| `ArrowDown` | Context menu open | Move focus to next item |
| `ArrowUp` | Context menu open | Move focus to previous item |
| `Enter` | Context menu, item focused | Execute focused item |
| `Enter` | FilePath focused (keyboard nav) | Open peek (same as Ctrl+Click) |

### 7.4 Dismissal Priority

When Escape is pressed:
1. If context menu is open, close context menu (peek stays)
2. If peek panel is open, close peek panel
3. Otherwise, propagate to other handlers (command palette, etc.)

Implementation: A single top-level `keydown` handler (or each component's handler checks higher-priority state). `FilePeekPanel`'s Escape handler must check `contextMenuStore.isOpen` before closing — if the context menu is open, Escape closes only the menu. Z-index affects visual stacking, not keyboard event propagation order.

Click-outside dismissal:
- Context menu: `mousedown` on `document`, check if target is outside menu, close if so
- Peek panel: NOT dismissed by click-outside (user needs to read code while interacting with chat). Dismissed only via Escape or X button.

---

## 8. Shiki Integration

### 8.1 Lazy Loading

Shiki is ~2MB and should not be loaded at startup. Strategy:

```typescript
// src/renderer/utils/shiki.ts

import type { Highlighter } from 'shiki'

let highlighterPromise: Promise<Highlighter> | null = null

export async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({
        themes: ['github-dark', 'github-light'],
        // Load a base set of languages; additional languages loaded on demand
        langs: [
          'typescript', 'tsx', 'javascript', 'jsx',
          'python', 'rust', 'go', 'java', 'json',
          'yaml', 'toml', 'markdown', 'html', 'css',
          'bash', 'sql', 'plaintext',
        ],
      })
    ).catch((err) => {
      // Reset so next attempt can retry instead of caching a rejected promise
      highlighterPromise = null
      throw err
    })
  }
  return highlighterPromise
}

export async function highlightCode(
  code: string,
  language: string,
  isDark: boolean,
): Promise<string> {
  const highlighter = await getHighlighter()
  const theme = isDark ? 'github-dark' : 'github-light'

  // If language isn't loaded, fall back to plaintext
  const loadedLangs = highlighter.getLoadedLanguages()
  const lang = loadedLangs.includes(language as any) ? language : 'plaintext'

  return highlighter.codeToHtml(code, {
    lang,
    theme,
  })
}
```

**Loading timeline:**
- First peek triggers `import('shiki')` — takes ~200-500ms on modern hardware
- Subsequent peeks use the cached highlighter instance (near-instant)
- While loading, show the code as plain monospace text (no highlighting) with a subtle "Loading syntax highlighting..." indicator

### 8.2 Theme Integration

Use `useThemeStore` to detect dark/light mode:

```typescript
const isDark = useThemeStore((s) => s.isDark)
```

Pass `isDark` to `highlightCode()` to select `github-dark` or `github-light` Shiki theme. These themes integrate well with the app's existing dark/light color system.

When theme changes while peek is open, re-run `highlightCode()` with the new theme. Use a `useEffect` that depends on `isDark` to trigger re-highlighting.

### 8.3 Rendering

Shiki returns an HTML string. Render it via `dangerouslySetInnerHTML` on a container div. This is safe because:
- The input is file content that Shiki escapes (it does not pass through raw HTML)
- The content comes from the user's own filesystem via a validated IPC channel

**Safety boundary:** The Shiki HTML output must go directly to `dangerouslySetInnerHTML` without any intermediate HTML processing (e.g., search-and-replace for highlighting). Any future feature that modifies the HTML between Shiki output and rendering (e.g., search highlighting) must operate on the Shiki tokens, not on the raw HTML string, to avoid XSS.

Add line numbers as a separate gutter column (not part of Shiki output) to keep selection clean — users can select code text without line numbers.

---

## 9. Error Handling

### 9.1 File Not Found

**Trigger:** File was deleted or moved after Claude referenced it.
**Detection:** `existsSync()` returns false in main process handler.
**Response:** Return `{ ok: false, error: 'not_found', message: 'File not found: {filePath}' }`.
**UI:** Warning icon + message in the peek panel code area: "This file no longer exists. It may have been moved or deleted since Claude referenced it."

### 9.2 File Too Large

**Trigger:** File size > 100KB (102,400 bytes).
**Detection:** `statSync().size` check before reading.
**Response:** Return `{ ok: false, error: 'too_large', message: 'File is {sizeFormatted} — maximum preview size is 100KB' }`.
**UI:** Info icon + message with the actual file size. Offer "Reveal in Explorer" as an alternative action.

### 9.3 Binary File

**Trigger:** File contains null bytes in the first 8KB.
**Detection:** Read first 8192 bytes into a Buffer, check `buffer.includes(0)`.
**Response:** Return `{ ok: false, error: 'binary', message: 'Binary file cannot be displayed' }`.
**UI:** File icon + message: "This is a binary file and cannot be previewed as text."

### 9.4 Permission Denied

**Trigger:** OS-level read permission denied.
**Detection:** `readFileSync` throws with `EACCES` or `EPERM` code.
**Response:** Return `{ ok: false, error: 'permission_denied', message: 'Permission denied: {filePath}' }`.
**UI:** Lock icon + message.

### 9.5 Outside Workspace

**Trigger:** Resolved path does not start with the tab's working directory.
**Detection:** Path prefix check after normalization.
**Response:** Return `{ ok: false, error: 'outside_workspace', message: 'File is outside the current workspace' }`.
**UI:** Shield icon + message. This is a security boundary, not a user error.

---

## 10. Security

### 10.1 Workspace Boundary Enforcement

All three IPC handlers (FILE_READ, FILE_REVEAL, FILE_OPEN_EXTERNAL) enforce the same security boundary. All require `workingDirectory` in their payload.

```typescript
import { resolve, normalize, sep } from 'path'
import { existsSync, realpathSync } from 'fs'

function isPathWithinWorkspace(filePath: string, workingDirectory: string): boolean {
  const resolved = resolve(workingDirectory, filePath)

  // Use realpathSync to resolve symlinks — prevents symlink escape attacks.
  // Both the workspace base and target must be resolved through realpathSync.
  // Only call realpathSync if the file exists (it throws otherwise).
  let normalizedTarget: string
  let normalizedBase: string

  try {
    normalizedBase = realpathSync(workingDirectory)
  } catch {
    normalizedBase = normalize(workingDirectory)
  }

  if (existsSync(resolved)) {
    try {
      normalizedTarget = realpathSync(resolved)
    } catch {
      normalizedTarget = normalize(resolved)
    }
  } else {
    normalizedTarget = normalize(resolved)
  }

  // Ensure the resolved path starts with the workspace directory
  return normalizedTarget.startsWith(normalizedBase + sep) ||
         normalizedTarget === normalizedBase
}
```

### 10.2 Path Traversal Prevention

The `resolve()` + `realpathSync()` + `normalize()` combination handles:
- `../../etc/passwd` — resolves to outside workspace, rejected
- `foo/../../../etc/passwd` — same
- **Symlink escape:** A symlink inside the workspace pointing to `/etc/passwd` is resolved via `realpathSync()` to its real target, which fails the prefix check

### 10.3 No Write Access

v1 is read-only. The IPC handlers only call `readFileSync`, `shell.showItemInFolder`, and `shell.openPath`. No write operations are exposed.

### 10.4 Rate Limiting

No explicit rate limiting on file reads — these are local filesystem operations triggered by user clicks, not automated. The 100KB size cap and 5000-line limit provide natural bounds on resource consumption.

---

## 11. Wiring Checklist

Step-by-step implementation order:

### Step 1: Types (`src/shared/types.ts`)

Add to the `IPC` const object (after line 575, before the closing `} as const`):

```typescript
// File peek
FILE_READ: 'clui:file-read',
FILE_REVEAL: 'clui:file-reveal',
FILE_OPEN_EXTERNAL: 'clui:file-open-external',
```

### Step 2: Main Process Handlers (`src/main/index.ts`)

Add three `ipcMain.handle` blocks after the Git Context IPC section (~line 986):

- `IPC.FILE_READ` handler with workspace validation, size check, binary detection, content reading, language detection
- `IPC.FILE_REVEAL` handler calling `shell.showItemInFolder()`
- `IPC.FILE_OPEN_EXTERNAL` handler calling `shell.openPath()`

Import `readFileSync`, `statSync` from `fs` (already imported at line 3) and `resolve`, `normalize`, `sep` from `path` (partially imported at line 2).

### Step 3: Preload Bridge (`src/preload/index.ts`)

Add to `CluiAPI` interface (after line 106):

```typescript
fileRead(workingDirectory: string, filePath: string): Promise<{
  ok: boolean
  content?: string
  language?: string
  lineCount?: number
  truncated?: boolean
  fileSize?: number
  error?: string
  message?: string
}>
fileReveal(filePath: string, workingDirectory: string): Promise<boolean>
fileOpenExternal(filePath: string, workingDirectory: string): Promise<boolean>
```

Add implementations to the `api` object:

```typescript
fileRead: (workingDirectory, filePath) =>
  ipcRenderer.invoke(IPC.FILE_READ, { workingDirectory, filePath }),
fileReveal: (filePath, workingDirectory) =>
  ipcRenderer.invoke(IPC.FILE_REVEAL, { filePath, workingDirectory }),
fileOpenExternal: (filePath, workingDirectory) =>
  ipcRenderer.invoke(IPC.FILE_OPEN_EXTERNAL, { filePath, workingDirectory }),
```

### Step 4: Stores (`src/renderer/stores/`)

Create:
- `src/renderer/stores/filePeekStore.ts` (as specified in section 4.1)
- `src/renderer/stores/contextMenuStore.ts` (as specified in section 4.2)

### Step 5: Shiki Utility (`src/renderer/utils/shiki.ts`)

Create the lazy-loading Shiki utility (as specified in section 8.1).

Add `shiki` to `package.json` dependencies:

```bash
npm install shiki
```

### Step 6: Components (`src/renderer/components/`)

Create in this order (each can be tested independently):

1. `FilePath.tsx` — no external dependencies beyond stores
2. `FileContextMenu.tsx` — depends on contextMenuStore, FilePath actions
3. `FilePeekPanel.tsx` — depends on filePeekStore, Shiki utility

### Step 7: Mount in App.tsx (`src/renderer/App.tsx`)

Add imports:

```typescript
import { FilePeekPanel } from './components/FilePeekPanel'
import { FileContextMenu } from './components/FileContextMenu'
import { useFilePeekStore } from './stores/filePeekStore'
import { useContextMenuStore } from './stores/contextMenuStore'
```

Add store selectors:

```typescript
const filePeekOpen = useFilePeekStore((s) => s.isOpen)
const contextMenuOpen = useContextMenuStore((s) => s.isOpen)
```

Mount `<FilePeekPanel>` as a new `<AnimatePresence>` block in the panel stack (between existing panels, at `zIndex: 32`). Follow the exact same wrapper pattern used by MarketplacePanel (lines 306-338):

```tsx
<AnimatePresence initial={false}>
  {filePeekOpen && (
    <div
      data-clui-ui
      style={{
        width: 720,
        maxWidth: 720,
        marginLeft: '50%',
        transform: 'translateX(-50%)',
        marginBottom: 14,
        position: 'relative',
        zIndex: 32,
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.985 }}
        transition={TRANSITION}
      >
        <div
          data-clui-ui
          className="glass-surface overflow-hidden no-drag"
          style={{ borderRadius: 24, maxHeight: 470 }}
        >
          <FilePeekPanel />
        </div>
      </motion.div>
    </div>
  )}
</AnimatePresence>
```

Mount `<FileContextMenu>` outside the panel stack, at the top level inside `<ErrorBoundary>` (it uses absolute positioning via portal or direct placement):

```tsx
{contextMenuOpen && <FileContextMenu />}
```

### Step 8: Integrate `<FilePath>` into ConversationView

Modify `src/renderer/components/ConversationView.tsx`:

1. Import `FilePath` component
2. Create `isLikelyFilePath()` utility function
3. Add `code` component to `markdownComponents` in `AssistantMessage` (line 578)
4. Create `ToolDescriptionWithFilePath` helper that wraps `file_path` values from tool input in `<FilePath>`
5. Update the tool description rendering in the ToolGroup timeline

### Step 9: Integrate `<FilePath>` into DiffViewer

Modify `src/renderer/components/DiffViewer.tsx`:

1. Import `FilePath` component
2. Wrap the file name `<span>` in the header (line 95-105) with `<FilePath path={filePath} displayName={fileName} />`
3. Add `e.stopPropagation()` inside `<FilePath>` to prevent toggling the diff collapse

---

## 12. Future Extensibility

### 12.1 Edit Mode (v2)

The architecture explicitly supports a future edit mode. Here is what would change:

**Store additions to `filePeekStore`:**

```typescript
// New state fields
mode: 'peek' | 'edit'
dirtyContent: string | null
isDirty: boolean
undoStack: string[]
redoStack: string[]
saving: boolean
saveError: string | null

// New actions
enterEditMode: () => void
exitEditMode: () => void
updateContent: (content: string) => void
undo: () => void
redo: () => void
saveFile: () => Promise<void>
```

**New IPC channel:**

```typescript
IPC.FILE_WRITE: 'clui:file-write'
```

Payload: `{ workingDirectory: string, filePath: string, content: string }`
Same workspace security boundary as FILE_READ.

**Component changes:**

- `FilePeekPanel` gains an "Edit" button in the header (Phosphor `PencilSimple` icon)
- Code area switches from `dangerouslySetInnerHTML` (Shiki output) to a `<textarea>` or lightweight code editor (e.g. CodeMirror 6) when in edit mode
- Header shows "Unsaved changes" badge when `isDirty === true`
- Save via Ctrl+S shortcut

### 12.2 Go-to-Line

Future addition: accepting a `line` parameter in `openPeek()` that scrolls to and highlights a specific line. This is useful when clicking a file path in a tool result that references a specific line number.

Store change: add `highlightLine: number | null` to state.
Component change: scroll to that line on open and apply a highlight background.

### 12.3 Multi-File Peek

Future addition: tabbed peek panel allowing multiple files to be open simultaneously. Store change: replace single `filePath`/`content` with an array of `PeekTab` entries and an `activeTabIndex`.
