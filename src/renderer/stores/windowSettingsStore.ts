/**
 * Unified window settings store — opacity, expandedUI persistence,
 * project colors, and width mode.
 */
import { createStore } from 'zustand/vanilla'

export type WidthMode = 'auto' | 'compact' | 'wide' | 'ultrawide'

export interface WindowSettings {
  opacity: number
  expandedUI: boolean
  projectColors: Record<string, string>
  widthMode: WidthMode
}

export interface WindowSettingsActions {
  setOpacity: (opacity: number) => void
  setExpandedUI: (expanded: boolean) => void
  setProjectColor: (projectPath: string, color: string) => void
  removeProjectColor: (projectPath: string) => void
  getProjectColor: (projectPath: string) => string | undefined
  setWidthMode: (mode: WidthMode) => void
}

export type WindowSettingsState = WindowSettings & WindowSettingsActions

const STORAGE_KEY = 'clui-window-settings'

export const DEFAULT_WINDOW_SETTINGS: WindowSettings = {
  opacity: 1.0,
  expandedUI: false,
  projectColors: {},
  widthMode: 'auto',
}

function loadFromStorage(): WindowSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        opacity: typeof parsed.opacity === 'number' ? parsed.opacity : DEFAULT_WINDOW_SETTINGS.opacity,
        expandedUI: typeof parsed.expandedUI === 'boolean' ? parsed.expandedUI : DEFAULT_WINDOW_SETTINGS.expandedUI,
        projectColors: parsed.projectColors && typeof parsed.projectColors === 'object' ? parsed.projectColors : {},
        widthMode: ['auto', 'compact', 'wide', 'ultrawide'].includes(parsed.widthMode) ? parsed.widthMode : 'auto',
      }
    }
  } catch {}
  return { ...DEFAULT_WINDOW_SETTINGS }
}

function saveToStorage(state: WindowSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      opacity: state.opacity,
      expandedUI: state.expandedUI,
      projectColors: state.projectColors,
      widthMode: state.widthMode,
    }))
  } catch {}
}

function clampOpacity(v: number): number {
  return Math.min(1.0, Math.max(0.3, v))
}

export function createWindowSettingsStore() {
  const initial = loadFromStorage()

  return createStore<WindowSettingsState>((set, get) => ({
    ...initial,

    setOpacity: (opacity: number) => {
      const clamped = clampOpacity(opacity)
      set({ opacity: clamped })
      saveToStorage({ ...get(), opacity: clamped })
    },

    setExpandedUI: (expanded: boolean) => {
      set({ expandedUI: expanded })
      saveToStorage({ ...get(), expandedUI: expanded })
    },

    setProjectColor: (projectPath: string, color: string) => {
      const next = { ...get().projectColors, [projectPath]: color }
      set({ projectColors: next })
      saveToStorage({ ...get(), projectColors: next })
    },

    removeProjectColor: (projectPath: string) => {
      const next = { ...get().projectColors }
      delete next[projectPath]
      set({ projectColors: next })
      saveToStorage({ ...get(), projectColors: next })
    },

    getProjectColor: (projectPath: string) => {
      return get().projectColors[projectPath]
    },

    setWidthMode: (mode: WidthMode) => {
      set({ widthMode: mode })
      saveToStorage({ ...get(), widthMode: mode })
    },
  }))
}
