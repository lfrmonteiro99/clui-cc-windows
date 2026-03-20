# WSL Runtime Support Implementation Plan

> **Commit convention:** Per project conventions, commits should be made at phase completion, not per-task. The commit messages in each task are guidelines for the commit content, not separate commits.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to run the Claude CLI inside WSL for projects that live on the Linux filesystem, while keeping Windows native as the default runtime.

**Architecture:** Two-phase approach. Phase 0 fixes the existing Windows cmd.exe escaping by spawning `node.exe` directly instead of `shell: true`. Phases 1-4 add WSL as an optional runtime: detect WSL availability, spawn via `wsl.exe`, adapt the permission hook server for WSL2 networking, and add UI for directory browsing + runtime selection. Each tab tracks its runtime independently.

**Tech Stack:** Electron 33, TypeScript strict, Node.js child_process, WSL2 interop via `wsl.exe`, React 19 + Zustand 5 (renderer), Vitest (tests).

**Prerequisite reading:** `CLAUDE.md` for conventions. `src/shared/types.ts` for IPC constants pattern. `src/main/platform.ts` for platform detection patterns.

---

## Phase 0: Fix Windows Escaping (No Shell)

> Eliminates `shell: true` on Windows by resolving the `.cmd` file to the underlying `node.exe` + `cli.js` call. This is a standalone fix independent of WSL.

### Task 0.1: Resolve Claude CLI Entry Point on Windows

**Files:**
- Modify: `src/main/platform.ts`
- Test: `tests/unit/platform.test.ts`

- [ ] **Step 1: Write failing test for `resolveClaudeEntryPoint`**

```typescript
// tests/unit/platform.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('resolveClaudeEntryPoint', () => {
  it('returns node + cli.js path when claude.cmd is found', () => {
    // Mock: claude.cmd exists at C:\Users\test\AppData\Roaming\npm\claude.cmd
    // Mock: reading claude.cmd reveals node_modules path
    // Expect: { binary: 'node', args: ['C:\\...\\cli.js'] }
  })

  it('falls back to claude binary when .cmd not found', () => {
    // Expect: { binary: 'claude', args: [] }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/platform.test.ts --reporter=verbose`

- [ ] **Step 3: Implement `resolveClaudeEntryPoint` in platform.ts**

```typescript
export interface ClaudeEntryPoint {
  binary: string
  prefixArgs: string[]
}

export function resolveClaudeEntryPoint(): ClaudeEntryPoint {
  const claudePath = findClaudeBinary()

  if (process.platform !== 'win32') {
    return { binary: claudePath, prefixArgs: getClaudeLaunchPrefixArgs() }
  }

  // On Windows, try to resolve .cmd to the underlying node + cli.js
  // This avoids shell: true and all cmd.exe escaping issues
  try {
    const resolved = resolveWindowsCmdToNode(claudePath)
    if (resolved) return resolved
  } catch {
    // Fall through to shell-based approach
  }

  return { binary: claudePath, prefixArgs: getClaudeLaunchPrefixArgs() }
}

function resolveWindowsCmdToNode(claudePath: string): ClaudeEntryPoint | null {
  const { existsSync, readFileSync } = require('fs')
  const { join, dirname } = require('path')

  // Find the .cmd file
  let cmdPath = claudePath
  if (!cmdPath.endsWith('.cmd')) {
    cmdPath = `${claudePath}.cmd`
  }
  if (!existsSync(cmdPath)) {
    // Try common npm global locations
    const appdata = process.env.APPDATA
    if (appdata) {
      cmdPath = join(appdata, 'npm', 'claude.cmd')
    }
  }
  if (!existsSync(cmdPath)) return null

  // Parse .cmd to find the cli.js path
  const content = readFileSync(cmdPath, 'utf-8')
  // npm .cmd files contain: "%~dp0\node_modules\@anthropic-ai\claude-code\cli.js"
  const match = content.match(/node_modules[\\/]@anthropic-ai[\\/]claude-code[\\/]cli\.js/i)
    || content.match(/node_modules[\\/]\.bin[\\/]claude/i)
  if (!match) return null

  const cmdDir = dirname(cmdPath)
  const cliJsPath = join(cmdDir, match[0])
  if (!existsSync(cliJsPath)) return null

  return { binary: 'node', prefixArgs: [cliJsPath] }
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/main/platform.ts tests/unit/platform.test.ts
git commit -m "WSL-001: Add resolveClaudeEntryPoint to bypass cmd.exe on Windows"
```

### Task 0.2: Use Direct Node Spawn in RunManager

**Files:**
- Modify: `src/main/claude/run-manager.ts`
- Test: `tests/unit/run-manager-spawn.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe('RunManager spawn on Windows', () => {
  it('spawns without shell:true when entry point is resolved', () => {
    // Verify spawn() is called with shell: false when resolveClaudeEntryPoint returns node+cli.js
  })

  it('passes args with special characters without escaping', () => {
    // Verify that --system-prompt containing <xml> tags is passed directly
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Modify `startRun` to use `resolveClaudeEntryPoint`**

In `run-manager.ts`, replace the spawn call:

```typescript
import { resolveClaudeEntryPoint } from '../platform'

// In constructor:
private entryPoint = resolveClaudeEntryPoint()

// In startRun, replace the spawn block:
const args: string[] = [
  ...this.entryPoint.prefixArgs,
  '-p',
  '--input-format', 'stream-json',
  // ... rest of args unchanged
]

const child = spawn(this.entryPoint.binary, args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd,
  env: this._getEnv(),
  // No shell: true needed — direct node invocation
})
```

Remove the Windows cmd.exe escaping block (the `if (process.platform === 'win32')` arg sanitization).

- [ ] **Step 4: Run full test suite**

Run: `npm run test`

- [ ] **Step 5: Commit**

```bash
git add src/main/claude/run-manager.ts tests/unit/run-manager-spawn.test.ts
git commit -m "WSL-001: Spawn node directly on Windows, eliminate shell:true"
```

---

## Phase 1: WSL Detection & Process Spawning

### Task 1.1: WSL Detection Utilities

**Files:**
- Create: `src/main/wsl/detection.ts`
- Test: `tests/unit/wsl/detection.test.ts`

- [ ] **Step 1: Write failing tests for WSL detection**

```typescript
// tests/unit/wsl/detection.test.ts
import { describe, it, expect } from 'vitest'

describe('WSL detection', () => {
  describe('isWslAvailable', () => {
    it('returns false when wsl.exe is not found')
    it('returns true when wsl.exe exists and has distros')
  })

  describe('listWslDistros', () => {
    it('parses wsl --list --verbose output correctly')
    it('filters out docker-desktop distros')
    it('identifies the default distro')
    it('handles UTF-16LE BOM encoding from wsl.exe')
    it('returns empty array when WSL not installed')
  })

  describe('checkClaudeInWsl', () => {
    it('returns true when claude is found in distro')
    it('returns false when claude is not installed')
    it('returns false when distro is not running and cold start fails')
  })

  describe('convertPathToWsl', () => {
    it('converts C:\\Users\\foo to /mnt/c/Users/foo')
    it('converts D:\\projects to /mnt/d/projects')
    it('passes through already-linux paths unchanged')
    it('handles \\\\wsl$\\Ubuntu\\home\\foo paths')
    it('handles \\\\wsl.localhost\\Ubuntu\\home\\foo paths (Windows 11+)')
    it('normalizes backslashes to forward slashes')
  })

  describe('convertPathToWindows', () => {
    it('converts /mnt/c/Users/foo to C:\\Users\\foo')
    it('converts /home/foo to \\\\wsl.localhost\\<distro>\\home\\foo')
    it('passes through already-windows paths unchanged')
  })

  describe('detectRuntimeFromPath', () => {
    it('returns native for C:\\ paths')
    it('returns wsl for any absolute Linux path not under /mnt/')
    it('returns wsl for \\\\wsl$\\ paths')
    it('returns wsl for \\\\wsl.localhost\\ paths')
    it('returns native for /mnt/ paths')
    it('returns native for relative paths')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement WSL detection**

```typescript
// src/main/wsl/detection.ts
import { execSync, execFileSync } from 'child_process'

export interface WslDistro {
  name: string
  isDefault: boolean
  state: 'Running' | 'Stopped' | 'Installing'
  version: 1 | 2
}

export type RuntimeType = 'native' | 'wsl'

export function isWslAvailable(): boolean {
  if (process.platform !== 'win32') return false
  try {
    // --list --quiet is more reliable than --status (which may fail on older builds)
    const output = execSync('wsl.exe --list --quiet', { timeout: 5000, stdio: 'pipe' })
    // Returns non-empty output when at least one distro is installed
    return output.toString().trim().length > 0
  } catch {
    return false
  }
}

export function listWslDistros(): WslDistro[] {
  try {
    const raw = execSync('wsl.exe --list --verbose', {
      timeout: 10000,
      stdio: 'pipe',
    }) as Buffer  // returns Buffer when no encoding specified
    // wsl.exe outputs UTF-16LE with BOM on some Windows versions
    let text = raw.toString('utf16le')
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)

    // Parse table: NAME STATE VERSION with * marking default
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    const distros: WslDistro[] = []

    for (const line of lines.slice(1)) { // skip header
      const isDefault = line.startsWith('*')
      const parts = line.replace('*', '').trim().split(/\s+/)
      if (parts.length < 3) continue
      const name = parts[0]
      const state = parts[1] as WslDistro['state']
      const version = parseInt(parts[2], 10) as 1 | 2

      // Filter out docker distros
      if (name.toLowerCase().startsWith('docker-desktop')) continue

      distros.push({ name, isDefault, state, version })
    }
    return distros
  } catch {
    return []
  }
}

export function getDefaultDistro(): string | null {
  const distros = listWslDistros()
  return distros.find(d => d.isDefault)?.name
    ?? distros[0]?.name
    ?? null
}

export function checkClaudeInWsl(distro: string): boolean {
  try {
    // Use execFileSync to prevent shell injection via distro name
    execFileSync('wsl.exe', ['-d', distro, '--', 'which', 'claude'], {
      timeout: 15000, // cold start can be slow
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

export function convertPathToWsl(windowsPath: string): string {
  // Already a Linux path
  if (windowsPath.startsWith('/')) return windowsPath

  // \\wsl$\Ubuntu\home\foo or \\wsl.localhost\Ubuntu\home\foo → /home/foo
  const wslUncMatch = windowsPath.match(/^\\\\wsl[\$\.][^\\]*\\[^\\]+(.*)$/)
  if (wslUncMatch) {
    return wslUncMatch[1].replace(/\\/g, '/')
  }

  // C:\Users\foo → /mnt/c/Users/foo
  const driveMatch = windowsPath.match(/^([A-Za-z]):\\(.*)$/)
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase()
    const rest = driveMatch[2].replace(/\\/g, '/')
    return `/mnt/${drive}/${rest}`
  }

  return windowsPath.replace(/\\/g, '/')
}

export function convertPathToWindows(linuxPath: string, distro: string): string {
  // Already a Windows path
  if (/^[A-Za-z]:/.test(linuxPath)) return linuxPath
  if (linuxPath.startsWith('\\\\')) return linuxPath

  // /mnt/c/Users/foo → C:\Users\foo
  const mntMatch = linuxPath.match(/^\/mnt\/([a-z])\/(.*)$/)
  if (mntMatch) {
    return `${mntMatch[1].toUpperCase()}:\\${mntMatch[2].replace(/\//g, '\\')}`
  }

  // /home/foo → \\wsl.localhost\<distro>\home\foo  (Windows 11+ format, also works via \\wsl$\)
  return `\\\\wsl.localhost\\${distro}${linuxPath.replace(/\//g, '\\')}`
}

export function detectRuntimeFromPath(path: string): RuntimeType {
  if (path.match(/^\\\\wsl[\$\.]/i)) return 'wsl'
  if (path.startsWith('/') && !path.startsWith('/mnt/')) return 'wsl'
  return 'native'
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/main/wsl/detection.ts tests/unit/wsl/detection.test.ts
git commit -m "WSL-002: Add WSL detection utilities (distros, paths, claude check)"
```

### Task 1.2: WSL Process Spawner

**Files:**
- Create: `src/main/wsl/wsl-spawner.ts`
- Test: `tests/unit/wsl/wsl-spawner.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('WslSpawner', () => {
  it('spawns via wsl.exe with --distribution and --cd')
  it('converts hookSettingsPath to WSL path')
  it('converts projectPath to WSL path')
  it('does not use shell: true')
  it('kills process via stdin close on cancel')
  it('detects WSL distro crash vs CLI crash from exit code')
})
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement WSL spawner**

```typescript
// src/main/wsl/wsl-spawner.ts
import { spawn, ChildProcess } from 'child_process'
import { convertPathToWsl } from './detection'

export interface WslSpawnOptions {
  distro: string
  args: string[]
  cwd: string
  env: Record<string, string>
  hookSettingsPath?: string
}

export function spawnInWsl(options: WslSpawnOptions): ChildProcess {
  const wslCwd = convertPathToWsl(options.cwd)

  // Convert Windows paths in args to WSL paths
  const wslArgs = options.args.map(arg => {
    // Convert hook settings path
    if (options.hookSettingsPath && arg === options.hookSettingsPath) {
      return convertPathToWsl(arg)
    }
    // Convert --add-dir paths (Windows paths starting with drive letter)
    if (/^[A-Za-z]:\\/.test(arg)) {
      return convertPathToWsl(arg)
    }
    return arg
  })

  const child = spawn('wsl.exe', [
    '--distribution', options.distro,
    '--cd', wslCwd,
    '--',
    'claude',
    ...wslArgs,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: options.env,
    // No shell: true — wsl.exe handles everything
  })

  return child
}
```

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add src/main/wsl/wsl-spawner.ts tests/unit/wsl/wsl-spawner.test.ts
git commit -m "WSL-002: Add WSL process spawner with path conversion"
```

### Task 1.3: Integrate WSL Spawn into RunManager

**Files:**
- Modify: `src/main/claude/run-manager.ts`
- Modify: `src/shared/types.ts` (add runtime to RunOptions)
- Test: `tests/unit/run-manager-wsl.test.ts`

- [ ] **Step 1: Add `runtime` to RunOptions in types.ts**

```typescript
// In src/shared/types.ts, add to RunOptions:
export interface RunOptions {
  // ... existing fields
  runtime?: 'native' | 'wsl'
  wslDistro?: string
}
```

- [ ] **Step 2: Write failing test**

```typescript
describe('RunManager WSL integration', () => {
  it('uses spawnInWsl when runtime is wsl')
  it('uses direct spawn when runtime is native')
  it('passes wslDistro to spawner')
  it('converts hookSettingsPath for WSL')
})
```

- [ ] **Step 3: Modify RunManager.startRun to route by runtime**

```typescript
// In startRun, after building args array:
let child: ChildProcess

if (options.runtime === 'wsl' && options.wslDistro) {
  child = spawnInWsl({
    distro: options.wslDistro,
    args,
    cwd,
    env: this._getEnv(),
    hookSettingsPath: options.hookSettingsPath,
  })
} else {
  child = spawn(this.entryPoint.binary, [
    ...this.entryPoint.prefixArgs,
    ...args,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd,
    env: this._getEnv(),
  })
}
```

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add src/main/claude/run-manager.ts src/shared/types.ts tests/unit/run-manager-wsl.test.ts
git commit -m "WSL-002: Route RunManager spawn by runtime (native vs wsl)"
```

---

## Phase 2: Permission Server Networking for WSL2

> WSL2 runs in a Hyper-V VM. `127.0.0.1` inside WSL2 does NOT reach the Windows host. We need to detect the Windows host IP from within WSL2 and inject it into the hook settings file.

### Task 2.1: Detect Windows Host IP for WSL2

**Files:**
- Modify: `src/main/wsl/detection.ts`
- Test: `tests/unit/wsl/detection.test.ts` (add tests)

- [ ] **Step 1: Write failing test**

```typescript
describe('getWindowsHostIpForWsl', () => {
  it('returns IP from /etc/resolv.conf nameserver')
  it('returns 127.0.0.1 for WSL1 (shared network stack)')
  it('returns 127.0.0.1 when mirrored networking is enabled')
  it('returns null when detection fails')
})
```

- [ ] **Step 2: Implement**

```typescript
export function getWindowsHostIpForWsl(distro: string): string {
  // Check if mirrored networking is enabled (127.0.0.1 works)
  try {
    const wslconfig = readFileSync(
      join(process.env.USERPROFILE || '', '.wslconfig'), 'utf-8'
    )
    if (/networkingMode\s*=\s*mirrored/i.test(wslconfig)) {
      return '127.0.0.1'
    }
  } catch { /* no .wslconfig */ }

  // Check WSL version — WSL1 shares network stack
  const distros = listWslDistros()
  const target = distros.find(d => d.name === distro)
  if (target?.version === 1) return '127.0.0.1'

  // WSL2: get host IP from resolv.conf
  try {
    // Use execFileSync to prevent shell injection via distro name
    const output = execFileSync(
      'wsl.exe', ['-d', distro, '--', 'cat', '/etc/resolv.conf'],
      { timeout: 5000, encoding: 'utf-8' }
    )
    const match = output.match(/nameserver\s+(\d+\.\d+\.\d+\.\d+)/)
    if (match) return match[1]
  } catch { /* fall through */ }

  // Last resort: try localhost (might work with newer Windows builds)
  return '127.0.0.1'
}
```

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git add src/main/wsl/detection.ts tests/unit/wsl/detection.test.ts
git commit -m "WSL-003: Detect Windows host IP for WSL2 hook server connectivity"
```

### Task 2.2: Generate WSL-Aware Hook Settings

**Files:**
- Modify: `src/main/hooks/permission-server.ts`
- Test: `tests/unit/hooks/permission-server-wsl.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe('generateSettingsFile for WSL', () => {
  it('uses Windows host IP instead of 127.0.0.1 for WSL2')
  it('converts file path to WSL format')
  it('uses 127.0.0.1 for native runtime')
})
```

- [ ] **Step 2: Add `enableWslAccess()` / `disableWslAccess()` to permission-server.ts**

When a WSL2 tab in NAT mode is active, the permission server must temporarily bind to `0.0.0.0` so the WSL2 VM can reach it. Add:

```typescript
// In permission-server.ts
enableWslAccess(): void {
  // Rebind server to 0.0.0.0 to accept connections from WSL2 VM
  // SECURITY TRADE-OFF: This exposes the permission server to LAN.
  // Mitigated by: per-launch appSecret + per-run tokens in URL.
  // Alternative: users can set networkingMode=mirrored in .wslconfig to avoid this.
  this.server.close()
  this.server.listen(this.port, '0.0.0.0')
}

disableWslAccess(): void {
  // Rebind to loopback only when no WSL2 NAT tabs remain active
  this.server.close()
  this.server.listen(this.port, '127.0.0.1')
}
```

Call `enableWslAccess()` when the first WSL2 NAT-mode tab starts, and `disableWslAccess()` when the last one ends. Track active WSL2 NAT tab count in ControlPlane.

> **Security note:** This deviates from CLAUDE.md's "Permission server binds to 127.0.0.1 only" rule. The appSecret + runToken in the URL path mitigate unauthorized access, but LAN exposure is a real trade-off. Document this in CLAUDE.md when implemented. Prefer recommending `networkingMode=mirrored` in `.wslconfig` as the zero-risk alternative.

- [ ] **Step 3: Add overload to `generateSettingsFile`**

```typescript
// In permission-server.ts
generateSettingsFile(
  runToken: string,
  wslOptions?: { distro: string; hostIp: string }
): string {
  const port = this._actualPort || this.port
  const hookHost = wslOptions?.hostIp || '127.0.0.1'

  const settings = {
    hooks: {
      PreToolUse: [{
        matcher: HOOK_MATCHER,
        hooks: [{
          type: 'http',
          url: `http://${hookHost}:${port}/hook/pre-tool-use/${this.appSecret}/${runToken}`,
          timeout: 300,
        }],
      }],
    },
  }
  // ... rest unchanged
}
```

- [ ] **Step 4: Update ControlPlane._dispatch to pass WSL options**

In the hook settings generation block:

```typescript
if (this.permissionServer.getPort()) {
  const runToken = this.permissionServer.registerRun(tabId, requestId, options.sessionId || null)
  this.runTokens.set(requestId, runToken)

  let wslHookOptions: { distro: string; hostIp: string } | undefined
  if (options.runtime === 'wsl' && options.wslDistro) {
    const hostIp = getWindowsHostIpForWsl(options.wslDistro)
    wslHookOptions = { distro: options.wslDistro, hostIp }
  }

  const hookSettingsPath = this.permissionServer.generateSettingsFile(runToken, wslHookOptions)
  options = { ...options, hookSettingsPath }
}
```

- [ ] **Step 5: Run tests**

- [ ] **Step 6: Commit**

```bash
git add src/main/hooks/permission-server.ts src/main/claude/control-plane.ts tests/unit/hooks/permission-server-wsl.test.ts
git commit -m "WSL-003: WSL2-aware hook settings with host IP detection + 0.0.0.0 rebind"
```

---

## Phase 3: IPC & Renderer Wiring

### Task 3.1: Add WSL IPC Channels

**Files:**
- Modify: `src/shared/types.ts` (IPC constants + types)
- Modify: `src/main/index.ts` (handlers)
- Modify: `src/preload/index.ts` (bridge)

- [ ] **Step 1: Add IPC constants and types**

```typescript
// In src/shared/types.ts IPC object:
WSL_STATUS: 'clui:wsl-status',          // Get WSL availability + distros
WSL_CHECK_CLAUDE: 'clui:wsl-check-claude', // Check claude exists in distro
WSL_BROWSE: 'clui:wsl-browse',          // Open file picker at WSL path

// Add types:
export interface WslStatus {
  available: boolean
  distros: Array<{
    name: string
    isDefault: boolean
    state: 'Running' | 'Stopped' | 'Installing'
    version: 1 | 2
    hasClaude: boolean | null // null = not checked yet
  }>
}

// Extend TabState (renderer-side):
export interface TabState {
  // ... existing fields
  runtime: 'native' | 'wsl'
  wslDistro: string | null
}

// ALSO extend TabRegistryEntry (main-process, in control-plane.ts):
// Add runtime: 'native' | 'wsl' and wslDistro: string | null
// Initialize in createTab() in ControlPlane:  runtime: 'native', wslDistro: null
// Initialize in makeLocalTab() in sessionStore: runtime: 'native', wslDistro: null
```

- [ ] **Step 2: Add IPC handlers in index.ts**

```typescript
ipcMain.handle(IPC.WSL_STATUS, async () => {
  if (process.platform !== 'win32') {
    return { available: false, distros: [] }
  }
  const available = isWslAvailable()
  const distros = available ? listWslDistros() : []
  return {
    available,
    distros: distros.map(d => ({
      ...d,
      hasClaude: null, // Lazy check — don't block startup
    })),
  }
})

ipcMain.handle(IPC.WSL_CHECK_CLAUDE, async (_event, distro: string) => {
  return checkClaudeInWsl(distro)
})

ipcMain.handle(IPC.WSL_BROWSE, async (_event, distro: string) => {
  if (!mainWindow) return null
  // Use \\wsl.localhost\ (Windows 11+) with \\wsl$\ fallback
  const wslHome = `\\\\wsl.localhost\\${distro}\\home`
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: wslHome,
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})
```

- [ ] **Step 3: Add WSL methods to `CluiAPI` interface and preload bridge**

In `src/preload/index.ts`, add to the `CluiAPI` interface:

```typescript
// In CluiAPI interface:
wslStatus(): Promise<WslStatus>
wslCheckClaude(distro: string): Promise<boolean>
wslBrowse(distro: string): Promise<string | null>
```

And add the bridge implementations:

```typescript
// In contextBridge.exposeInMainWorld:
wslStatus: () => ipcRenderer.invoke(IPC.WSL_STATUS),
wslCheckClaude: (distro: string) => ipcRenderer.invoke(IPC.WSL_CHECK_CLAUDE, distro),
wslBrowse: (distro: string) => ipcRenderer.invoke(IPC.WSL_BROWSE, distro),
```

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/main/index.ts src/preload/index.ts
git commit -m "WSL-004: Add WSL IPC channels (status, check-claude, browse)"
```

### Task 3.2: Wire Runtime into ControlPlane Dispatch

**Files:**
- Modify: `src/main/claude/control-plane.ts`
- Modify: `src/main/index.ts` (pass runtime from PROMPT handler)

- [ ] **Step 1: Pass runtime through PROMPT IPC handler**

In `index.ts` IPC.PROMPT handler, the renderer sends `options.runtime` and `options.wslDistro`. These flow through to `controlPlane.submitPrompt()` → `_dispatch()` → `runManager.startRun()`.

No ControlPlane changes needed — `RunOptions` already carries `runtime` and `wslDistro` from Task 1.3.

- [ ] **Step 2: Update ingestionService.initTab to handle WSL paths**

```typescript
// In IPC.PROMPT handler:
try {
  const projectPath = options.projectPath
  if (projectPath) {
    ingestionService.initTab(tabId, projectPath)
  }
  ingestionService.ingestUserMessage(tabId, requestId, options.prompt || '', [])
} catch (err) {
  log(`Ingestion error (prompt capture): ${err}`)
}
```

The ingestionService already normalizes paths. WSL paths (`/home/...`) will be stored as-is — which is correct since they identify the project uniquely.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts src/main/claude/control-plane.ts
git commit -m "WSL-004: Wire runtime selection through dispatch chain"
```

---

## Phase 4: Renderer UI

### Task 4.1: WSL Status Store

**Files:**
- Create: `src/renderer/stores/wslStore.ts`
- Test: `tests/unit/stores/wslStore.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe('wslStore', () => {
  it('initializes with available=false')
  it('fetches WSL status on init')
  it('checks claude availability per distro lazily')
  it('returns default distro name')
})
```

- [ ] **Step 2: Implement store**

```typescript
// src/renderer/stores/wslStore.ts
import { create } from 'zustand'

interface WslDistroInfo {
  name: string
  isDefault: boolean
  state: 'Running' | 'Stopped' | 'Installing'
  version: 1 | 2
  hasClaude: boolean | null
}

interface WslState {
  available: boolean
  distros: WslDistroInfo[]
  initialized: boolean
  init: () => Promise<void>
  checkClaude: (distro: string) => Promise<boolean>
  getDefaultDistro: () => string | null
  browseWsl: (distro: string) => Promise<string | null>
}

export const useWslStore = create<WslState>((set, get) => ({
  available: false,
  distros: [],
  initialized: false,

  init: async () => {
    if (get().initialized) return
    const status = await window.clui.wslStatus()
    set({
      available: status.available,
      distros: status.distros,
      initialized: true,
    })
  },

  checkClaude: async (distro: string) => {
    const result = await window.clui.wslCheckClaude(distro)
    set(state => ({
      distros: state.distros.map(d =>
        d.name === distro ? { ...d, hasClaude: result } : d
      ),
    }))
    return result
  },

  getDefaultDistro: () => {
    const { distros } = get()
    return distros.find(d => d.isDefault)?.name ?? distros[0]?.name ?? null
  },

  browseWsl: async (distro: string) => {
    return window.clui.wslBrowse(distro)
  },
}))
```

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git add src/renderer/stores/wslStore.ts tests/unit/stores/wslStore.test.ts
git commit -m "WSL-005: Add WSL status Zustand store"
```

### Task 4.2: Enhanced Directory Picker with WSL Support

**Files:**
- Find and modify: the component that handles working directory selection (likely in `InputBar.tsx` or a dedicated `DirectoryPicker` component)
- Create: `src/renderer/components/DirectoryPicker.tsx` (if not existing)

- [ ] **Step 1: Identify current directory picker implementation**

Search for `selectDirectory` or `SELECT_DIRECTORY` usage in renderer components.

- [ ] **Step 2: Create/modify DirectoryPicker component**

The component should include:
- Text input for typing/pasting paths (accepts both Windows and Linux paths)
- Two browse buttons: `[<Folder /> Windows]` and `[<LinuxLogo /> WSL]` (Phosphor icons — no emojis per CLAUDE.md)
- WSL button disabled with tooltip when WSL not available
- WSL button shows distro submenu when multiple distros exist
- Recent paths list with `<LinuxLogo />`/`<Folder />` icons
- WSL home quick-access shortcut
- Auto-detection confirmation: "Detected: WSL (Ubuntu)" with a "Change" button/dropdown to override the auto-detected runtime
- Inline validation: check path exists, check claude in WSL distro

```typescript
// Key component structure:
function DirectoryPicker({ tabId, currentPath, onPathChange }) {
  const { available, distros, checkClaude, browseWsl } = useWslStore()
  const colors = useColors()

  // Auto-detect runtime from path
  const detectedRuntime = detectRuntimeFromPath(currentPath)

  return (
    <div>
      {/* Text input */}
      <input value={currentPath} onChange={...} placeholder="Project path..." />

      {/* Browse buttons — use Phosphor icons, not emojis */}
      <button onClick={handleBrowseWindows}><Folder /> Windows</button>
      {available && (
        <button onClick={handleBrowseWsl}><LinuxLogo /> WSL</button>
      )}

      {/* Runtime detection badge with override dropdown */}
      {currentPath && (
        <RuntimeBadge
          detected={detectedRuntime}
          onOverride={(runtime, distro) => onRuntimeChange(runtime, distro)}
          distros={distros}
        />
      )}

      {/* Recent paths */}
      <RecentPaths onSelect={onPathChange} />
    </div>
  )
}
```

- [ ] **Step 3: Wire distro selection for multi-distro**

When WSL button is clicked and multiple distros exist, show a small dropdown:

```typescript
const handleBrowseWsl = async () => {
  let distro: string
  if (distros.length === 1) {
    distro = distros[0].name
  } else {
    // Show distro selector popover
    distro = await showDistroSelector(distros)
    if (!distro) return
  }

  // Validate claude is installed
  const hasClaude = await checkClaude(distro)
  if (!hasClaude) {
    showError(`Claude CLI not found in WSL '${distro}'. Install with: npm install -g @anthropic-ai/claude-code`)
    return
  }

  const path = await browseWsl(distro)
  if (path) onPathChange(path, 'wsl', distro)
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/DirectoryPicker.tsx
git commit -m "WSL-005: Enhanced directory picker with WSL browse + auto-detect"
```

### Task 4.3: Runtime Badge on Tab Strip

**Files:**
- Modify: `src/renderer/components/TabStrip.tsx`

- [ ] **Step 1: Add runtime badge next to StatusDot**

```typescript
// In TabItem component, after StatusDot:
{tab.runtime === 'wsl' && (
  <span
    style={{
      fontSize: 9,
      fontWeight: 600,
      color: colors.textSecondary,
      backgroundColor: colors.surfaceHover,
      borderRadius: 3,
      padding: '1px 4px',
      marginLeft: 4,
      flexShrink: 0,
    }}
    title={`WSL: ${tab.wslDistro}`}
  >
    WSL
  </span>
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/TabStrip.tsx
git commit -m "WSL-005: Add WSL runtime badge on tabs"
```

### Task 4.4: Block Runtime Switch on Active Sessions

**Files:**
- Modify: `src/renderer/stores/sessionStore.impl.ts`

- [ ] **Step 1: Add guard in `setWorkingDirectory` or equivalent**

When the user changes the working directory (which can change the detected runtime):
- If tab status is `running` or `connecting`: reject with error toast "Stop the current session to change runtime"
- If tab is `idle`, `completed`, `dead`: allow change, warn that session cannot be resumed

- [ ] **Step 2: Commit**

```bash
git add src/renderer/stores/sessionStore.impl.ts
git commit -m "WSL-005: Block runtime change on active tabs"
```

---

## Phase 5: Error Handling & Polish

### Task 5.1: Differentiated Error Messages for WSL

**Files:**
- Modify: `src/main/claude/run-manager.ts` or `control-plane.ts`

- [ ] **Step 1: Detect WSL distro crash vs CLI crash**

When a WSL-spawned process exits with non-zero code:

```typescript
if (options.runtime === 'wsl' && options.wslDistro) {
  // Check if the distro is still running
  try {
    const distros = listWslDistros()
    const target = distros.find(d => d.name === options.wslDistro)
    if (!target || target.state !== 'Running') {
      // Distro crashed or was terminated externally
      enriched.message = `WSL distro '${options.wslDistro}' is no longer running. Restart it with: wsl -d ${options.wslDistro}`
    }
  } catch { /* fall through to generic error */ }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/claude/run-manager.ts
git commit -m "WSL-006: Differentiated error messages for WSL distro crash"
```

### Task 5.2: File Peek Path Translation for WSL Tabs

**Files:**
- Modify: `src/main/file-peek-handlers.ts`

- [ ] **Step 1: Convert file paths for WSL tabs**

When a file peek request comes from a WSL tab, the path from Claude's output will be a Linux path (e.g., `/home/user/project/src/main.ts`). To open it from Windows, convert to `\\wsl$\<distro>\home\user\...`.

```typescript
// In handleFileReveal or handleFileOpenExternal:
if (tabRuntime === 'wsl' && tabDistro) {
  filePath = convertPathToWindows(filePath, tabDistro)
}
```

This requires passing the tab's runtime info through the IPC call.

- [ ] **Step 2: Commit**

```bash
git add src/main/file-peek-handlers.ts
git commit -m "WSL-006: Translate file peek paths for WSL tabs"
```

### Task 5.3: Process Kill for WSL

**Files:**
- Modify: `src/main/claude/run-manager.ts`
- Test: `tests/unit/wsl/wsl-kill.test.ts`

- [ ] **Step 1: Write failing tests for WSL process kill**

```typescript
// tests/unit/wsl/wsl-kill.test.ts
describe('WSL process kill', () => {
  it('closes stdin before sending SIGINT')
  it('force-kills after 5s timeout if process still alive')
  it('handles already-destroyed stdin gracefully')
})
```

- [ ] **Step 2: Implement graceful kill for WSL processes**

```typescript
// In cancel() method:
cancel(requestId: string): boolean {
  const handle = this.activeRuns.get(requestId)
  if (!handle) return false

  // For WSL processes, closing stdin is the most reliable kill signal
  // wsl.exe propagates stdin close to the child process
  if (handle.process.stdin && !handle.process.stdin.destroyed) {
    handle.process.stdin.end()
  }

  // Also send SIGINT through the wsl.exe shim
  handle.process.kill('SIGINT')

  // Force kill after timeout (same as existing logic)
  setTimeout(() => {
    if (this.activeRuns.has(requestId)) {
      handle.process.kill('SIGKILL')
    }
  }, 5000)

  return true
}
```

Note: stdin close propagates reliably through `wsl.exe`. The existing `kill('SIGINT')` on the `wsl.exe` Windows process also sends SIGINT to the child in most cases. The combination of both is the safest approach.

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git add src/main/claude/run-manager.ts tests/unit/wsl/wsl-kill.test.ts
git commit -m "WSL-006: Graceful kill for WSL processes via stdin close + SIGINT"
```

---

## Execution Order & Dependencies

```
Phase 0 (standalone — fixes Windows escaping, no WSL dependency)
  Task 0.1 → Task 0.2

Phase 1 (standalone — spawns via wsl.exe, does NOT depend on Phase 0's resolveClaudeEntryPoint)
  Task 1.1 → Task 1.2 → Task 1.3

Phase 0 and Phase 1 are independent and can be developed in parallel.

Phase 2 (depends on Phase 1)
  Task 2.1 → Task 2.2

Phase 3 (depends on Phase 1, parallel with Phase 2)
  Task 3.1 → Task 3.2
  Task 4.1 → Task 4.2 → Task 4.3 → Task 4.4

Phase 5 (depends on all above)
  Task 5.1, 5.2, 5.3 (independent, parallelizable)
```

## Known Limitations (Accepted)

1. **WSL2 + VPN**: May break hook server connectivity. Document as known limitation.
2. **Cold start latency**: 2-8s for first WSL spawn. No workaround — show loading indicator.
3. **`/mnt/c/` performance**: Cross-filesystem access is slow. Users should keep projects on native WSL fs.
4. **Enterprise Group Policy**: Some orgs block WSL. WSL button simply won't appear.
5. **WSL1 vs WSL2**: Both supported, but WSL2 recommended. Networking differences handled in Task 2.1.
