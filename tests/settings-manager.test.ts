import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// We'll test the SettingsManager with a temp directory instead of real ~/.claude
const TEST_DIR = join(tmpdir(), `clui-test-${Date.now()}`)
const TEST_SETTINGS_PATH = join(TEST_DIR, 'settings.json')

// Import after defining paths so we can inject them
import { SettingsManager, PERMISSION_PRESETS, type PermissionPreset } from '../src/main/settings-manager'

describe('SettingsManager', () => {
  let manager: SettingsManager

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    manager = new SettingsManager(TEST_SETTINGS_PATH)
  })

  afterEach(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}
  })

  // ─── Reading settings ───

  describe('readSettings', () => {
    it('returns empty permissions when settings.json does not exist', () => {
      const settings = manager.readSettings()
      expect(settings.permissions).toBeDefined()
      expect(settings.permissions.allow).toEqual([])
      expect(settings.permissions.deny).toEqual([])
    })

    it('reads existing settings.json correctly', () => {
      writeFileSync(TEST_SETTINGS_PATH, JSON.stringify({
        permissions: {
          allow: ['Bash(git:*)', 'Read'],
          deny: ['Write'],
        },
        env: { FOO: 'bar' },
      }))
      const settings = manager.readSettings()
      expect(settings.permissions.allow).toEqual(['Bash(git:*)', 'Read'])
      expect(settings.permissions.deny).toEqual(['Write'])
      expect(settings.env).toEqual({ FOO: 'bar' })
    })

    it('handles malformed JSON gracefully', () => {
      writeFileSync(TEST_SETTINGS_PATH, '{ broken json }}}')
      const settings = manager.readSettings()
      expect(settings.permissions.allow).toEqual([])
    })

    it('handles missing permissions key gracefully', () => {
      writeFileSync(TEST_SETTINGS_PATH, JSON.stringify({ env: {} }))
      const settings = manager.readSettings()
      expect(settings.permissions.allow).toEqual([])
      expect(settings.permissions.deny).toEqual([])
    })
  })

  // ─── Adding permissions ───

  describe('addPermission', () => {
    it('adds a permission to an empty allow list', () => {
      manager.addPermission('Bash(gh:*)')
      const settings = manager.readSettings()
      expect(settings.permissions.allow).toContain('Bash(gh:*)')
    })

    it('adds a permission to an existing allow list', () => {
      writeFileSync(TEST_SETTINGS_PATH, JSON.stringify({
        permissions: { allow: ['Read'], deny: [] },
      }))
      manager.addPermission('Bash(gh:*)')
      const settings = manager.readSettings()
      expect(settings.permissions.allow).toContain('Read')
      expect(settings.permissions.allow).toContain('Bash(gh:*)')
    })

    it('does not duplicate an existing permission', () => {
      writeFileSync(TEST_SETTINGS_PATH, JSON.stringify({
        permissions: { allow: ['Bash(gh:*)'] },
      }))
      manager.addPermission('Bash(gh:*)')
      const settings = manager.readSettings()
      const count = settings.permissions.allow.filter((p: string) => p === 'Bash(gh:*)').length
      expect(count).toBe(1)
    })

    it('preserves other settings when adding a permission', () => {
      writeFileSync(TEST_SETTINGS_PATH, JSON.stringify({
        permissions: { allow: ['Read'] },
        env: { DEBUG: '1' },
        language: 'Português',
      }))
      manager.addPermission('Bash(npm:*)')
      const raw = JSON.parse(readFileSync(TEST_SETTINGS_PATH, 'utf-8'))
      expect(raw.env).toEqual({ DEBUG: '1' })
      expect(raw.language).toBe('Português')
      expect(raw.permissions.allow).toContain('Bash(npm:*)')
    })

    it('creates settings.json and parent directory if they do not exist', () => {
      const deepPath = join(TEST_DIR, 'sub', 'deep', 'settings.json')
      const deepManager = new SettingsManager(deepPath)
      deepManager.addPermission('Edit')
      const settings = deepManager.readSettings()
      expect(settings.permissions.allow).toContain('Edit')
    })
  })

  // ─── Removing permissions ───

  describe('removePermission', () => {
    it('removes an existing permission', () => {
      writeFileSync(TEST_SETTINGS_PATH, JSON.stringify({
        permissions: { allow: ['Bash(gh:*)', 'Read', 'Edit'] },
      }))
      manager.removePermission('Read')
      const settings = manager.readSettings()
      expect(settings.permissions.allow).not.toContain('Read')
      expect(settings.permissions.allow).toContain('Bash(gh:*)')
      expect(settings.permissions.allow).toContain('Edit')
    })

    it('is a no-op when permission does not exist', () => {
      writeFileSync(TEST_SETTINGS_PATH, JSON.stringify({
        permissions: { allow: ['Read'] },
      }))
      manager.removePermission('Edit')
      const settings = manager.readSettings()
      expect(settings.permissions.allow).toEqual(['Read'])
    })
  })

  // ─── Getting permissions ───

  describe('getPermissions', () => {
    it('returns structured permission data', () => {
      writeFileSync(TEST_SETTINGS_PATH, JSON.stringify({
        permissions: { allow: ['Bash(gh:*)', 'Read'], deny: ['Write'] },
      }))
      const perms = manager.getPermissions()
      expect(perms.allow).toEqual(['Bash(gh:*)', 'Read'])
      expect(perms.deny).toEqual(['Write'])
    })
  })

  // ─── Presets ───

  describe('applyPreset', () => {
    it('applies permissive preset', () => {
      manager.applyPreset('permissive')
      const settings = manager.readSettings()
      expect(settings.permissions.allow.length).toBeGreaterThan(0)
      // Permissive should include wildcard Bash
      expect(settings.permissions.allow.some((p: string) => p.includes('Bash'))).toBe(true)
      expect(settings.permissions.allow.some((p: string) => p.includes('Edit'))).toBe(true)
      expect(settings.permissions.allow.some((p: string) => p.includes('Write'))).toBe(true)
    })

    it('applies balanced preset', () => {
      manager.applyPreset('balanced')
      const settings = manager.readSettings()
      // Balanced should include reads + git + gh but not blanket Bash
      expect(settings.permissions.allow.some((p: string) => p.includes('git'))).toBe(true)
      expect(settings.permissions.allow.some((p: string) => p.includes('gh:'))).toBe(true)
    })

    it('applies strict preset', () => {
      manager.applyPreset('strict')
      const settings = manager.readSettings()
      // Strict should have minimal permissions or empty
      expect(settings.permissions.allow.length).toBeLessThanOrEqual(
        PERMISSION_PRESETS.strict.length
      )
    })

    it('preserves non-permission settings when applying preset', () => {
      writeFileSync(TEST_SETTINGS_PATH, JSON.stringify({
        permissions: { allow: ['OLD'] },
        env: { KEEP: 'me' },
        language: 'Português',
      }))
      manager.applyPreset('permissive')
      const raw = JSON.parse(readFileSync(TEST_SETTINGS_PATH, 'utf-8'))
      expect(raw.env).toEqual({ KEEP: 'me' })
      expect(raw.language).toBe('Português')
      expect(raw.permissions.allow).not.toContain('OLD')
    })
  })

  // ─── First launch detection ───

  describe('needsSetup', () => {
    it('returns true when settings.json does not exist', () => {
      expect(manager.needsSetup()).toBe(true)
    })

    it('returns true when settings.json exists but has no permissions.allow', () => {
      writeFileSync(TEST_SETTINGS_PATH, JSON.stringify({ env: {} }))
      expect(manager.needsSetup()).toBe(true)
    })

    it('returns true when permissions.allow is empty', () => {
      writeFileSync(TEST_SETTINGS_PATH, JSON.stringify({
        permissions: { allow: [] },
      }))
      expect(manager.needsSetup()).toBe(true)
    })

    it('returns false when permissions.allow has entries', () => {
      writeFileSync(TEST_SETTINGS_PATH, JSON.stringify({
        permissions: { allow: ['Bash(gh:*)'] },
      }))
      expect(manager.needsSetup()).toBe(false)
    })

    it('returns false after setup has been dismissed (flag set)', () => {
      manager.dismissSetup()
      expect(manager.needsSetup()).toBe(false)
    })
  })

  // ─── Tool name to permission pattern ───

  describe('toolNameToPermission', () => {
    it('converts Bash to Bash(*)', () => {
      expect(SettingsManager.toolNameToPermission('Bash')).toBe('Bash(*)')
    })

    it('converts Edit to Edit', () => {
      expect(SettingsManager.toolNameToPermission('Edit')).toBe('Edit')
    })

    it('converts Write to Write', () => {
      expect(SettingsManager.toolNameToPermission('Write')).toBe('Write')
    })

    it('converts MultiEdit to MultiEdit', () => {
      expect(SettingsManager.toolNameToPermission('MultiEdit')).toBe('MultiEdit')
    })

    it('converts mcp__ tools to wildcard pattern', () => {
      expect(SettingsManager.toolNameToPermission('mcp__plugin_playwright_playwright__browser_navigate'))
        .toBe('mcp__plugin_playwright_playwright__browser_navigate')
    })
  })
})
