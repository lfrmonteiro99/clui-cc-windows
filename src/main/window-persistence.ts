/**
 * Window position and settings persistence (main process).
 * Stores position, opacity, and width mode in ~/.claude/clui-window.json.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

const CONFIG_PATH = join(homedir(), '.claude', 'clui-window.json')

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface PersistedWindowSettings {
  opacity: number
  widthMode: string
}

interface WindowConfigFile {
  position?: WindowBounds
  opacity?: number
  widthMode?: string
}

function readConfig(): WindowConfigFile | null {
  try {
    if (!existsSync(CONFIG_PATH)) return null
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeConfig(config: WindowConfigFile): void {
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true })
    writeFileSync(CONFIG_PATH, JSON.stringify(config))
  } catch {}
}

export function loadWindowPosition(): WindowBounds | null {
  const config = readConfig()
  if (!config?.position) return null
  const p = config.position
  if (typeof p.x === 'number' && typeof p.y === 'number' &&
      typeof p.width === 'number' && typeof p.height === 'number') {
    return { x: p.x, y: p.y, width: p.width, height: p.height }
  }
  return null
}

export function saveWindowPosition(bounds: WindowBounds): void {
  const existing = readConfig() || {}
  writeConfig({ ...existing, position: bounds })
}

export function loadWindowSettings(): PersistedWindowSettings {
  const config = readConfig()
  return {
    opacity: typeof config?.opacity === 'number' ? config.opacity : 1.0,
    widthMode: typeof config?.widthMode === 'string' ? config.widthMode : 'auto',
  }
}

export function saveWindowSettings(settings: { opacity: number; widthMode: string }): void {
  const existing = readConfig() || {}
  writeConfig({ ...existing, opacity: settings.opacity, widthMode: settings.widthMode })
}
