/**
 * SettingsManager — Read/write Claude Code CLI settings.json
 *
 * Manages the permissions.allow / permissions.deny arrays in ~/.claude/settings.json.
 * Used by the Clui CC overlay to let users configure permissions from the UI
 * instead of manually editing JSON files.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'

// ─── Permission presets ───

export const PERMISSION_PRESETS = {
  /** Auto-approve everything — for users who trust the CLI fully */
  permissive: [
    'Bash(*)',
    'Edit',
    'Write',
    'MultiEdit',
    'WebSearch',
    'WebFetch(*)',
    'mcp__*',
  ],

  /** Auto-approve reads + git + gh + npm, ask for destructive writes */
  balanced: [
    'Bash(git:*)',
    'Bash(gh:*)',
    'Bash(npm:*)',
    'Bash(npx:*)',
    'Bash(node:*)',
    'Bash(ls:*)',
    'Bash(cat:*)',
    'Bash(find:*)',
    'Bash(grep:*)',
    'Bash(head:*)',
    'Bash(tail:*)',
    'Bash(wc:*)',
    'Bash(echo:*)',
    'Bash(tree:*)',
    'Bash(curl:*)',
    'Bash(python:*)',
    'Bash(python3:*)',
    'WebSearch',
    'WebFetch(*)',
  ],

  /** Minimal auto-approvals — the Claude permission system handles the rest */
  strict: [
    'WebSearch',
  ],
} satisfies Record<string, string[]>

export type PermissionPreset = keyof typeof PERMISSION_PRESETS

// ─── Settings file shape (subset we care about) ───

interface ClaudeSettings {
  permissions: {
    allow: string[]
    deny: string[]
    ask?: string[]
    defaultMode?: string
  }
  [key: string]: unknown
}

// ─── Setup dismissed flag file ───

const SETUP_DISMISSED_FILE = '.clui-setup-done'

// ─── SettingsManager ───

export class SettingsManager {
  private filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath || join(homedir(), '.claude', 'settings.json')
  }

  /** Read and parse settings.json. Returns safe defaults if file is missing or malformed. */
  readSettings(): ClaudeSettings {
    try {
      if (!existsSync(this.filePath)) {
        return this.defaultSettings()
      }
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      return {
        ...parsed,
        permissions: {
          allow: Array.isArray(parsed?.permissions?.allow) ? parsed.permissions.allow : [],
          deny: Array.isArray(parsed?.permissions?.deny) ? parsed.permissions.deny : [],
          ...(parsed?.permissions?.ask ? { ask: parsed.permissions.ask } : {}),
          ...(parsed?.permissions?.defaultMode ? { defaultMode: parsed.permissions.defaultMode } : {}),
        },
      }
    } catch {
      return this.defaultSettings()
    }
  }

  /** Write settings back to disk, preserving all non-permission fields. */
  private writeSettings(settings: ClaudeSettings): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(this.filePath, JSON.stringify(settings, null, 2), 'utf-8')
  }

  /** Add a permission pattern to the allow list. No-op if already present. */
  addPermission(pattern: string): void {
    const settings = this.readSettings()
    if (!settings.permissions.allow.includes(pattern)) {
      settings.permissions.allow.push(pattern)
      this.writeSettings(settings)
    }
  }

  /** Remove a permission pattern from the allow list. */
  removePermission(pattern: string): void {
    const settings = this.readSettings()
    const idx = settings.permissions.allow.indexOf(pattern)
    if (idx !== -1) {
      settings.permissions.allow.splice(idx, 1)
      this.writeSettings(settings)
    }
  }

  /** Get the current permission lists. */
  getPermissions(): { allow: string[]; deny: string[] } {
    const settings = this.readSettings()
    return {
      allow: settings.permissions.allow,
      deny: settings.permissions.deny,
    }
  }

  /** Replace the allow list with a preset. Preserves all other settings. */
  applyPreset(preset: PermissionPreset): void {
    const settings = this.readSettings()
    settings.permissions.allow = [...PERMISSION_PRESETS[preset]]
    this.writeSettings(settings)
  }

  /** Check if the user needs the first-launch permission wizard. */
  needsSetup(): boolean {
    // If user has previously dismissed the wizard, don't show again
    const dismissedPath = join(dirname(this.filePath), SETUP_DISMISSED_FILE)
    if (existsSync(dismissedPath)) return false

    const settings = this.readSettings()
    return settings.permissions.allow.length === 0
  }

  /** Mark the setup wizard as dismissed so it won't show again. */
  dismissSetup(): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(join(dir, SETUP_DISMISSED_FILE), '', 'utf-8')
  }

  /** Convert a tool name (from permission denial) to an appropriate permission pattern. */
  static toolNameToPermission(toolName: string): string {
    if (toolName === 'Bash') return 'Bash(*)'
    return toolName
  }

  private defaultSettings(): ClaudeSettings {
    return {
      permissions: {
        allow: [],
        deny: [],
      },
    }
  }
}
