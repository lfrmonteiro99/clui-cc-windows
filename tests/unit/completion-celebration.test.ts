import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── Theme store: celebrationEnabled ───

describe('celebrationEnabled setting', () => {
  beforeEach(() => {
    localStorage.clear()
    // Re-import fresh store for each test by resetting state
    vi.resetModules()
  })

  it('defaults to true', async () => {
    const { useThemeStore } = await import('../../src/renderer/theme')
    expect(useThemeStore.getState().celebrationEnabled).toBe(true)
  })

  it('setCelebrationEnabled updates state', async () => {
    const { useThemeStore } = await import('../../src/renderer/theme')
    useThemeStore.getState().setCelebrationEnabled(false)
    expect(useThemeStore.getState().celebrationEnabled).toBe(false)
  })

  it('setCelebrationEnabled persists to localStorage', async () => {
    const { useThemeStore } = await import('../../src/renderer/theme')
    useThemeStore.getState().setCelebrationEnabled(false)
    const raw = localStorage.getItem('clui-settings')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.celebrationEnabled).toBe(false)
  })

  it('loads celebrationEnabled from localStorage', async () => {
    localStorage.setItem('clui-settings', JSON.stringify({
      themeMode: 'dark',
      soundEnabled: true,
      expandedUI: false,
      autoResumeEnabled: true,
      autoResumeMaxRetries: 3,
      celebrationEnabled: false,
    }))
    const { useThemeStore } = await import('../../src/renderer/theme')
    expect(useThemeStore.getState().celebrationEnabled).toBe(false)
  })
})

// ─── ConfettiCelebration component structure ───

describe('ConfettiCelebration component', () => {
  const componentPath = join(__dirname, '../../src/renderer/components/ConfettiCelebration.tsx')
  const content = readFileSync(componentPath, 'utf-8')

  it('renders 25 particles', () => {
    expect(content).toContain('PARTICLE_COUNT = 25')
    expect(content).toContain('Array.from({ length: PARTICLE_COUNT }')
  })

  it('auto-hides after animation duration', () => {
    // Component sets visible=false after ANIMATION_DURATION + 200ms
    expect(content).toContain('ANIMATION_DURATION')
    expect(content).toContain('setTimeout(() => setVisible(false)')
  })

  it('uses clui-confetti-particle CSS class', () => {
    expect(content).toContain('clui-confetti-particle')
  })

  it('has data-testid for testing', () => {
    expect(content).toContain('data-testid="confetti-celebration"')
  })
})

// ─── CompletionSummary integration ───

describe('CompletionSummary celebration integration', () => {
  const summaryPath = join(__dirname, '../../src/renderer/components/CompletionSummary.tsx')
  const content = readFileSync(summaryPath, 'utf-8')

  it('imports ConfettiCelebration', () => {
    expect(content).toContain("import { ConfettiCelebration } from './ConfettiCelebration'")
  })

  it('checks celebrationEnabled before showing confetti', () => {
    expect(content).toContain('celebrationEnabled')
    expect(content).toContain('!lastResult.is_error')
  })

  it('tracks hasCelebrated to avoid re-firing', () => {
    expect(content).toContain('hasCelebrated')
  })

  it('dispatches a success toast on completion', () => {
    expect(content).toContain("type: 'success'")
    expect(content).toContain("title: 'Task Complete'")
  })
})

// ─── Settings toggle ───

describe('SettingsPopover celebration toggle', () => {
  const settingsPath = join(__dirname, '../../src/renderer/components/SettingsPopover.tsx')
  const content = readFileSync(settingsPath, 'utf-8')

  it('includes Confetti icon import', () => {
    expect(content).toContain('Confetti')
  })

  it('has completion celebration toggle', () => {
    expect(content).toContain('Completion celebration')
    expect(content).toContain('setCelebrationEnabled')
  })
})
