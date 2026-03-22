/**
 * TDD RED tests for windowSettingsStore — unified settings for
 * opacity, expandedUI persistence, project colors, width mode.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage before importing the store
const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, val: string) => storage.set(key, val)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
    clear: vi.fn(() => storage.clear()),
  },
  configurable: true,
})

// Mock window.clui
Object.defineProperty(globalThis, 'window', {
  value: {
    clui: {
      setOpacity: vi.fn(),
      setToggleShortcut: vi.fn(),
    },
  },
  configurable: true,
  writable: true,
})

import {
  createWindowSettingsStore,
  DEFAULT_WINDOW_SETTINGS,
  type WindowSettings,
  type WidthMode,
} from '../../src/renderer/stores/windowSettingsStore'

describe('windowSettingsStore', () => {
  beforeEach(() => {
    storage.clear()
    vi.clearAllMocks()
  })

  describe('defaults', () => {
    it('has opacity 1.0 by default', () => {
      const store = createWindowSettingsStore()
      expect(store.getState().opacity).toBe(1.0)
    })

    it('has expandedUI false by default', () => {
      const store = createWindowSettingsStore()
      expect(store.getState().expandedUI).toBe(false)
    })

    it('has empty project colors by default', () => {
      const store = createWindowSettingsStore()
      expect(store.getState().projectColors).toEqual({})
    })

    it('has widthMode auto by default', () => {
      const store = createWindowSettingsStore()
      expect(store.getState().widthMode).toBe('auto')
    })

    it('exports DEFAULT_WINDOW_SETTINGS constant', () => {
      expect(DEFAULT_WINDOW_SETTINGS).toEqual({
        opacity: 1.0,
        expandedUI: false,
        projectColors: {},
        widthMode: 'auto',
      })
    })
  })

  describe('opacity', () => {
    it('setOpacity updates state', () => {
      const store = createWindowSettingsStore()
      store.getState().setOpacity(0.7)
      expect(store.getState().opacity).toBe(0.7)
    })

    it('clamps opacity to minimum 0.3', () => {
      const store = createWindowSettingsStore()
      store.getState().setOpacity(0.1)
      expect(store.getState().opacity).toBe(0.3)
    })

    it('clamps opacity to maximum 1.0', () => {
      const store = createWindowSettingsStore()
      store.getState().setOpacity(1.5)
      expect(store.getState().opacity).toBe(1.0)
    })

    it('persists opacity to localStorage', () => {
      const store = createWindowSettingsStore()
      store.getState().setOpacity(0.8)
      const saved = JSON.parse(storage.get('clui-window-settings')!)
      expect(saved.opacity).toBe(0.8)
    })
  })

  describe('expandedUI persistence', () => {
    it('setExpandedUI updates state', () => {
      const store = createWindowSettingsStore()
      store.getState().setExpandedUI(true)
      expect(store.getState().expandedUI).toBe(true)
    })

    it('persists expandedUI to localStorage', () => {
      const store = createWindowSettingsStore()
      store.getState().setExpandedUI(true)
      const saved = JSON.parse(storage.get('clui-window-settings')!)
      expect(saved.expandedUI).toBe(true)
    })

    it('restores expandedUI from localStorage (does NOT reset to false)', () => {
      storage.set('clui-window-settings', JSON.stringify({
        ...DEFAULT_WINDOW_SETTINGS,
        expandedUI: true,
      }))
      const store = createWindowSettingsStore()
      expect(store.getState().expandedUI).toBe(true)
    })
  })

  describe('project colors', () => {
    it('setProjectColor assigns a color to a project', () => {
      const store = createWindowSettingsStore()
      store.getState().setProjectColor('/home/user/myproject', '#ff5733')
      expect(store.getState().projectColors['/home/user/myproject']).toBe('#ff5733')
    })

    it('getProjectColor returns undefined for unset projects', () => {
      const store = createWindowSettingsStore()
      expect(store.getState().getProjectColor('/unknown')).toBeUndefined()
    })

    it('getProjectColor returns the set color', () => {
      const store = createWindowSettingsStore()
      store.getState().setProjectColor('/proj', '#aabbcc')
      expect(store.getState().getProjectColor('/proj')).toBe('#aabbcc')
    })

    it('removeProjectColor deletes a project color', () => {
      const store = createWindowSettingsStore()
      store.getState().setProjectColor('/proj', '#aabbcc')
      store.getState().removeProjectColor('/proj')
      expect(store.getState().getProjectColor('/proj')).toBeUndefined()
    })

    it('persists project colors to localStorage', () => {
      const store = createWindowSettingsStore()
      store.getState().setProjectColor('/proj', '#112233')
      const saved = JSON.parse(storage.get('clui-window-settings')!)
      expect(saved.projectColors['/proj']).toBe('#112233')
    })
  })

  describe('width mode', () => {
    it('setWidthMode updates state', () => {
      const store = createWindowSettingsStore()
      store.getState().setWidthMode('wide')
      expect(store.getState().widthMode).toBe('wide')
    })

    it('persists widthMode to localStorage', () => {
      const store = createWindowSettingsStore()
      store.getState().setWidthMode('ultrawide')
      const saved = JSON.parse(storage.get('clui-window-settings')!)
      expect(saved.widthMode).toBe('ultrawide')
    })

    it('accepts all valid width modes', () => {
      const store = createWindowSettingsStore()
      const modes: WidthMode[] = ['auto', 'compact', 'wide', 'ultrawide']
      for (const mode of modes) {
        store.getState().setWidthMode(mode)
        expect(store.getState().widthMode).toBe(mode)
      }
    })
  })

  describe('hydration from localStorage', () => {
    it('restores all settings from localStorage on creation', () => {
      const saved: WindowSettings = {
        opacity: 0.6,
        expandedUI: true,
        projectColors: { '/proj': '#aaa' },
        widthMode: 'wide',
      }
      storage.set('clui-window-settings', JSON.stringify(saved))
      const store = createWindowSettingsStore()
      expect(store.getState().opacity).toBe(0.6)
      expect(store.getState().expandedUI).toBe(true)
      expect(store.getState().projectColors).toEqual({ '/proj': '#aaa' })
      expect(store.getState().widthMode).toBe('wide')
    })

    it('uses defaults for corrupt localStorage data', () => {
      storage.set('clui-window-settings', 'NOT_JSON')
      const store = createWindowSettingsStore()
      expect(store.getState().opacity).toBe(1.0)
      expect(store.getState().expandedUI).toBe(false)
    })
  })
})
