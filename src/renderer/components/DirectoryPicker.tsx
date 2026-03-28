import React, { useState, useRef, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Folder, LinuxLogo, Warning, ClockCounterClockwise, House,
} from '@phosphor-icons/react'
import { useWslStore, type WslDistroInfo } from '../stores/wslStore'
import { useColors } from '../theme'

// ─── Runtime detection (client-side, mirroring main/wsl/detection.ts) ───

export type RuntimeType = 'native' | 'wsl'

export function detectRuntimeFromPath(path: string): RuntimeType {
  // UNC WSL paths
  if (path.startsWith('\\\\wsl$\\') || path.startsWith('\\\\wsl.localhost\\')) {
    return 'wsl'
  }
  // Absolute Linux path
  if (path.startsWith('/')) {
    // /mnt/ paths are mounted Windows drives -- treat as native
    if (path.startsWith('/mnt/')) return 'native'
    return 'wsl'
  }
  // Everything else: Windows drive paths, relative paths, ~, empty
  return 'native'
}

/**
 * Extract the WSL distribution name from a UNC path.
 * e.g. \\wsl.localhost\Ubuntu\home\me -> 'Ubuntu'
 *      \\wsl$\Debian\home\me -> 'Debian'
 */
export function extractDistroFromUncPath(path: string): string | null {
  const match = path.match(/^\\\\wsl(?:\$|\.localhost)\\([^\\]+)/)
  return match?.[1] ?? null
}

// ─── Recent paths storage ───

interface RecentPath {
  path: string
  runtime: RuntimeType
  distro: string | null
  timestamp: number
}

const RECENT_PATHS_KEY = 'clui-recent-directory-paths'
const MAX_RECENT_PATHS = 5

function loadRecentPaths(): RecentPath[] {
  try {
    const raw = localStorage.getItem(RECENT_PATHS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as RecentPath[]
      return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_PATHS) : []
    }
  } catch { /* noop */ }
  return []
}

function saveRecentPath(path: string, runtime: RuntimeType, distro: string | null): void {
  try {
    const existing = loadRecentPaths().filter((p) => p.path !== path)
    const updated: RecentPath[] = [
      { path, runtime, distro, timestamp: Date.now() },
      ...existing,
    ].slice(0, MAX_RECENT_PATHS)
    localStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(updated))
  } catch { /* noop */ }
}

// ─── Props ───

interface DirectoryPickerProps {
  /** Called when a directory is selected and validated */
  onSelect: (dir: string, runtime: RuntimeType, distro: string | null) => void
}

// ─── Component ───

export function DirectoryPicker({ onSelect }: DirectoryPickerProps) {
  const colors = useColors()
  const wslAvailable = useWslStore((s) => s.available)
  const wslDistros = useWslStore((s) => s.distros)
  const wslInitialized = useWslStore((s) => s.initialized)
  const wslInit = useWslStore((s) => s.init)
  const wslCheckClaude = useWslStore((s) => s.checkClaude)
  const wslBrowse = useWslStore((s) => s.browseWsl)

  const [inputValue, setInputValue] = useState('')
  const [detectedRuntime, setDetectedRuntime] = useState<RuntimeType | null>(null)
  const [detectedDistro, setDetectedDistro] = useState<string | null>(null)
  const [claudeError, setClaudeError] = useState<string | null>(null)
  const [claudeChecking, setClaudeChecking] = useState(false)
  const [distroDropdownOpen, setDistroDropdownOpen] = useState(false)
  const [recentPaths, setRecentPaths] = useState<RecentPath[]>(loadRecentPaths)

  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Initialize WSL store on mount
  useEffect(() => {
    if (!wslInitialized) {
      void wslInit()
    }
  }, [wslInitialized, wslInit])

  // Close distro dropdown on outside click
  useEffect(() => {
    if (!distroDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDistroDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [distroDropdownOpen])

  // Runtime detection when input changes
  useEffect(() => {
    if (!inputValue.trim()) {
      setDetectedRuntime(null)
      setDetectedDistro(null)
      setClaudeError(null)
      return
    }

    const runtime = detectRuntimeFromPath(inputValue.trim())
    setDetectedRuntime(runtime)

    if (runtime === 'wsl') {
      const uncDistro = extractDistroFromUncPath(inputValue.trim())
      if (uncDistro) {
        setDetectedDistro(uncDistro)
      } else {
        // Default distro for paths like /home/...
        const defaultDistro = useWslStore.getState().getDefaultDistro()
        setDetectedDistro(defaultDistro)
      }
    } else {
      setDetectedDistro(null)
    }

    setClaudeError(null)
  }, [inputValue])

  // Validate Claude in WSL when a WSL path is detected
  const validateAndSelect = useCallback(async (path: string) => {
    const runtime = detectRuntimeFromPath(path)

    if (runtime === 'wsl') {
      const uncDistro = extractDistroFromUncPath(path)
      const distro = uncDistro ?? useWslStore.getState().getDefaultDistro()

      if (!distro) {
        setClaudeError('No WSL distribution found. Install one from the Microsoft Store.')
        return
      }

      setClaudeChecking(true)
      setClaudeError(null)

      const hasClaude = await wslCheckClaude(distro)

      setClaudeChecking(false)

      if (!hasClaude) {
        setClaudeError(`Claude CLI not found in WSL '${distro}'. Install with: npm install -g @anthropic-ai/claude-code`)
        return
      }

      saveRecentPath(path, 'wsl', distro)
      setRecentPaths(loadRecentPaths())
      onSelect(path, 'wsl', distro)
    } else {
      saveRecentPath(path, 'native', null)
      setRecentPaths(loadRecentPaths())
      onSelect(path, 'native', null)
    }
  }, [wslCheckClaude, onSelect])

  const handleInputSubmit = useCallback(() => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    void validateAndSelect(trimmed)
  }, [inputValue, validateAndSelect])

  const handleWindowsBrowse = useCallback(async () => {
    const dir = await window.clui.selectDirectory()
    if (dir) {
      setInputValue(dir)
      saveRecentPath(dir, 'native', null)
      setRecentPaths(loadRecentPaths())
      onSelect(dir, 'native', null)
    }
  }, [onSelect])

  const handleWslBrowse = useCallback(async (distro: WslDistroInfo) => {
    setDistroDropdownOpen(false)

    setClaudeChecking(true)
    setClaudeError(null)
    const hasClaude = await wslCheckClaude(distro.name)
    setClaudeChecking(false)

    if (!hasClaude) {
      setClaudeError(`Claude CLI not found in WSL '${distro.name}'. Install with: npm install -g @anthropic-ai/claude-code`)
      return
    }

    const dir = await wslBrowse(distro.name)
    if (dir) {
      setInputValue(dir)
      saveRecentPath(dir, 'wsl', distro.name)
      setRecentPaths(loadRecentPaths())
      onSelect(dir, 'wsl', distro.name)
    }
  }, [wslCheckClaude, wslBrowse, onSelect])

  const handleWslButtonClick = useCallback(() => {
    if (!wslAvailable) return

    if (wslDistros.length === 1) {
      void handleWslBrowse(wslDistros[0])
    } else {
      setDistroDropdownOpen((o) => !o)
    }
  }, [wslAvailable, wslDistros, handleWslBrowse])

  const handleRecentSelect = useCallback((recent: RecentPath) => {
    setInputValue(recent.path)
    void validateAndSelect(recent.path)
  }, [validateAndSelect])

  const handleWslHomeShortcut = useCallback(async () => {
    const distro = useWslStore.getState().getDefaultDistro()
    if (!distro) return

    setClaudeChecking(true)
    setClaudeError(null)
    const hasClaude = await wslCheckClaude(distro)
    setClaudeChecking(false)

    if (!hasClaude) {
      setClaudeError(`Claude CLI not found in WSL '${distro}'. Install with: npm install -g @anthropic-ai/claude-code`)
      return
    }

    const dir = await wslBrowse(distro)
    if (dir) {
      setInputValue(dir)
      saveRecentPath(dir, 'wsl', distro)
      setRecentPaths(loadRecentPaths())
      onSelect(dir, 'wsl', distro)
    }
  }, [wslCheckClaude, wslBrowse, onSelect])

  const handleOverrideRuntime = useCallback(() => {
    // Clear detection so user can type freely
    setDetectedRuntime(null)
    setDetectedDistro(null)
    setClaudeError(null)
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  const runtimeLabel = detectedRuntime === 'wsl' && detectedDistro
    ? `Detected: WSL (${detectedDistro})`
    : detectedRuntime === 'wsl'
      ? 'Detected: WSL'
      : detectedRuntime === 'native'
        ? (navigator.userAgent.includes('Linux') ? 'Detected: Linux' : 'Detected: Windows')
        : null

  return (
    <div data-testid="directory-picker" className="flex flex-col gap-2 px-4 py-3" style={{ minWidth: 0 }}>
      {/* Input row */}
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleInputSubmit()
            }
          }}
          placeholder="Type or paste a path..."
          className="flex-1 min-w-0 text-[12px] rounded-lg px-2.5 py-1.5 outline-none transition-colors"
          style={{
            background: colors.surfacePrimary,
            border: `1px solid ${colors.inputBorder}`,
            color: colors.textPrimary,
          }}
          onFocus={(e) => {
            (e.currentTarget as HTMLInputElement).style.borderColor = colors.inputFocusBorder
          }}
          onBlur={(e) => {
            (e.currentTarget as HTMLInputElement).style.borderColor = colors.inputBorder
          }}
        />

        {/* Windows browse button */}
        <button
          onClick={() => void handleWindowsBrowse()}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
          style={{
            background: colors.surfacePrimary,
            border: `1px solid ${colors.inputBorder}`,
            color: colors.textSecondary,
          }}
          title="Browse Windows folders"
        >
          <Folder size={14} weight="bold" />
        </button>

        {/* WSL browse button */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={handleWslButtonClick}
            disabled={!wslAvailable}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{
              background: wslAvailable ? colors.surfacePrimary : colors.surfaceHover,
              border: `1px solid ${colors.inputBorder}`,
              color: wslAvailable ? colors.textSecondary : colors.textMuted,
              cursor: wslAvailable ? 'pointer' : 'not-allowed',
              opacity: wslAvailable ? 1 : 0.5,
            }}
            title={wslAvailable ? 'Browse WSL folders' : 'WSL is not available on this system'}
          >
            <LinuxLogo size={14} weight="bold" />
          </button>

          {/* Multi-distro dropdown */}
          <AnimatePresence>
            {distroDropdownOpen && wslDistros.length > 1 && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.95 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-full mt-1 rounded-lg z-50"
                style={{
                  minWidth: 160,
                  background: colors.popoverBg,
                  border: `1px solid ${colors.popoverBorder}`,
                  boxShadow: colors.popoverShadow,
                }}
              >
                <div className="py-1">
                  {wslDistros.map((distro) => (
                    <button
                      key={distro.name}
                      onClick={() => void handleWslBrowse(distro)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors text-left"
                      style={{
                        color: distro.state === 'Running' ? colors.textPrimary : colors.textTertiary,
                      }}
                    >
                      <LinuxLogo size={12} />
                      <span className="flex-1 truncate">{distro.name}</span>
                      {distro.isDefault && (
                        <span
                          className="text-[9px] px-1 rounded"
                          style={{
                            color: colors.textTertiary,
                            background: colors.surfaceHover,
                          }}
                        >
                          default
                        </span>
                      )}
                      <span
                        className="text-[9px]"
                        style={{
                          color: distro.state === 'Running' ? colors.statusComplete : colors.textMuted,
                        }}
                      >
                        {distro.state}
                      </span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Runtime detection badge */}
      {runtimeLabel && inputValue.trim() && (
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
            style={{
              background: detectedRuntime === 'wsl' ? colors.accentLight : colors.surfaceHover,
              color: detectedRuntime === 'wsl' ? colors.accent : colors.textSecondary,
              border: `1px solid ${detectedRuntime === 'wsl' ? colors.accentBorder : colors.inputBorder}`,
            }}
          >
            {detectedRuntime === 'wsl' ? <LinuxLogo size={10} /> : <Folder size={10} />}
            {runtimeLabel}
          </span>
          <button
            onClick={handleOverrideRuntime}
            className="text-[10px] transition-colors"
            style={{ color: colors.textTertiary }}
          >
            Change
          </button>
        </div>
      )}

      {/* Claude validation error */}
      {claudeError && (
        <div
          className="flex items-start gap-1.5 text-[11px] px-2 py-1.5 rounded-lg"
          style={{
            background: colors.statusErrorBg,
            color: colors.statusError,
            border: `1px solid ${colors.permissionDeniedBorder}`,
          }}
        >
          <Warning size={12} className="flex-shrink-0 mt-0.5" weight="bold" />
          <span className="min-w-0 break-words">{claudeError}</span>
        </div>
      )}

      {/* Loading indicator */}
      {claudeChecking && (
        <div
          className="text-[11px] px-2"
          style={{ color: colors.textTertiary }}
        >
          Checking Claude CLI availability...
        </div>
      )}

      {/* Recent paths */}
      {recentPaths.length > 0 && (
        <div>
          <div
            className="flex items-center gap-1 text-[9px] uppercase tracking-wider px-1 mb-1"
            style={{ color: colors.textTertiary }}
          >
            <ClockCounterClockwise size={10} />
            Recent
          </div>
          <div className="flex flex-col">
            {recentPaths.map((recent) => (
              <button
                key={recent.path}
                onClick={() => handleRecentSelect(recent)}
                className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md transition-colors text-left truncate"
                style={{
                  color: colors.textSecondary,
                }}
                title={recent.path}
              >
                {recent.runtime === 'wsl' ? (
                  <LinuxLogo size={11} className="flex-shrink-0" />
                ) : (
                  <Folder size={11} className="flex-shrink-0" />
                )}
                <span className="truncate">{recent.path}</span>
                {recent.distro && (
                  <span
                    className="text-[9px] flex-shrink-0 px-1 rounded"
                    style={{
                      color: colors.textTertiary,
                      background: colors.surfaceHover,
                    }}
                  >
                    {recent.distro}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* WSL home shortcut */}
      {wslAvailable && useWslStore.getState().getDefaultDistro() && (
        <button
          onClick={() => void handleWslHomeShortcut()}
          className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md transition-colors text-left"
          style={{ color: colors.accent }}
        >
          <House size={11} />
          <LinuxLogo size={11} />
          WSL home ({useWslStore.getState().getDefaultDistro()})
        </button>
      )}
    </div>
  )
}
