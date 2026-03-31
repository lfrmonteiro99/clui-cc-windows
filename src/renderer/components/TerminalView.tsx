import React, { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from '@phosphor-icons/react'
import { useColors } from '../theme'
import { useTerminalStore } from '../stores/terminalStore'
import { TerminalSearch } from './TerminalSearch'
import { saveTerminalSession, loadTerminalSessions, deleteTerminalSession } from '../utils/terminal-persistence'
import { TERMINAL_SCHEMES } from '../utils/terminal-schemes'

/** TERM-005: Maximum image storage size in bytes (2 MB) */
const MAX_IMAGE_SIZE = 2 * 1024 * 1024

interface TerminalViewProps {
  termTabId: string
  isActive: boolean
}

export function TerminalView({ termTabId, isActive }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<any>(null) // xterm Terminal instance
  const fitAddonRef = useRef<any>(null)
  const searchAddonRef = useRef<any>(null)
  const serializeAddonRef = useRef<any>(null)
  const searchTermRef = useRef<string>('')
  const colors = useColors()
  const [loaded, setLoaded] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchResultIndex, setSearchResultIndex] = useState(-1)
  const [searchResultCount, setSearchResultCount] = useState(0)
  const [bellFlash, setBellFlash] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  // Lazy-load xterm.js and initialize
  useEffect(() => {
    let disposed = false

    async function init() {
      if (!containerRef.current || terminalRef.current) return

      const { Terminal } = await import('@xterm/xterm')
      const { FitAddon } = await import('@xterm/addon-fit')
      const { WebLinksAddon } = await import('@xterm/addon-web-links')
      const { SearchAddon } = await import('@xterm/addon-search')

      if (disposed) return

      const fitAddon = new FitAddon()
      const searchAddon = new SearchAddon()

      // Read settings from store
      const storeState = useTerminalStore.getState()
      const scrollbackSize = storeState.scrollbackSize ?? 5000
      const backgroundOpacity = storeState.backgroundOpacity ?? 1
      const backgroundBlur = storeState.backgroundBlur ?? 0
      const terminalScheme = storeState.terminalScheme ?? 'Default'

      // TERM-011: Mouse protocol support for TUI apps (vim, less, htop)
      // xterm.js v6 handles SGR1006 mouse protocol automatically. Key behaviors:
      //   - Mouse clicks/scroll forwarded to apps in alternate screen mode
      //   - Mouse drag selection works in normal mode
      //   - Right-click context menu accessible via Shift+Right-click bypass
      //   - Mouse events only sent when terminal is focused (xterm.js default)
      //   - No interference with copy/paste shortcuts (handled by attachCustomKeyEventHandler)
      // No explicit mouse options needed — xterm.js v6 enables them by default.
      // Do NOT set disableStdin or any mouse-blocking options here.
      const terminal = new Terminal({
        fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", Consolas, "Courier New", monospace',
        fontSize: 13,
        lineHeight: 1.3,
        cursorStyle: 'bar',
        cursorBlink: true,
        scrollback: scrollbackSize,
        theme: buildXtermTheme(colors, backgroundOpacity, terminalScheme),
        allowTransparency: true,
        allowProposedApi: true, // TERM-011: required for advanced mouse reporting features
      })

      // xterm 6.0: customKeyEventHandler is set via attachCustomKeyEventHandler, not constructor options
      terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        const isMac = navigator.platform.toLowerCase().includes('mac')
        const mod = isMac ? e.metaKey : e.ctrlKey

        // Copy: Ctrl+Shift+C always, or Ctrl+C/Cmd+C when text is selected
        if (mod && e.shiftKey && e.key === 'C' && e.type === 'keydown') {
          const sel = terminal.getSelection()
          if (sel) navigator.clipboard.writeText(sel)
          return false
        }
        if (mod && !e.shiftKey && e.key === 'c' && e.type === 'keydown') {
          const sel = terminal.getSelection()
          if (sel) {
            navigator.clipboard.writeText(sel)
            terminal.clearSelection()
            return false // intercept — don't send SIGINT
          }
          return true // no selection — let SIGINT through
        }

        // Paste: Ctrl+Shift+V or Ctrl+V/Cmd+V
        if (mod && (e.key === 'v' || e.key === 'V') && e.type === 'keydown') {
          navigator.clipboard.readText().then((text) => {
            if (text) terminal.paste(text)
          })
          return false
        }

        // Terminal shortcuts: new tab, close tab, cycle tabs
        if (mod && e.shiftKey && e.key === 'T' && e.type === 'keydown') {
          window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: 'new-tab' } }))
          return false
        }
        if (mod && e.shiftKey && e.key === 'W' && e.type === 'keydown') {
          window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: 'close-pane-or-tab', termTabId } }))
          return false
        }
        if (e.ctrlKey && e.key === 'Tab' && e.type === 'keydown') {
          window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: e.shiftKey ? 'prev-tab' : 'next-tab' } }))
          return false
        }

        // Split panes: Ctrl+Shift+D (horizontal), Ctrl+Shift+E (vertical)
        if (mod && e.shiftKey && e.key === 'D' && e.type === 'keydown') {
          window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: 'split-horizontal', termTabId } }))
          return false
        }
        if (mod && e.shiftKey && e.key === 'E' && e.type === 'keydown') {
          window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: 'split-vertical', termTabId } }))
          return false
        }

        // Tab overview: Ctrl+Shift+O
        if (mod && e.shiftKey && e.key === 'O' && e.type === 'keydown') {
          window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: 'tab-overview' } }))
          return false
        }

        // Font zoom: Ctrl+= / Ctrl+- / Ctrl+0
        if (mod && (e.key === '=' || e.key === '+') && e.type === 'keydown') {
          window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: 'zoom-in' } }))
          return false
        }
        if (mod && e.key === '-' && e.type === 'keydown') {
          window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: 'zoom-out' } }))
          return false
        }
        if (mod && e.key === '0' && e.type === 'keydown') {
          window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: 'zoom-reset' } }))
          return false
        }

        // Search: Ctrl+Shift+F
        if (mod && e.shiftKey && e.key === 'F' && e.type === 'keydown') {
          window.dispatchEvent(new CustomEvent('clui-terminal-shortcut', { detail: { action: 'toggle-search', termTabId } }))
          return false
        }

        // Toggle mode: Ctrl+`
        if (mod && e.key === '`' && e.type === 'keydown') {
          useTerminalStore.getState().toggleMode()
          return false
        }

        return true // pass everything else to PTY
      })

      terminal.loadAddon(fitAddon)
      terminal.loadAddon(new WebLinksAddon())
      terminal.loadAddon(searchAddon)
      searchAddonRef.current = searchAddon

      // Open terminal in DOM first — WebGL and other addons require an attached canvas
      terminal.open(containerRef.current!)
      fitAddon.fit()

      // TERM-001: WebGL GPU-accelerated renderer with DOM fallback
      // Must load AFTER terminal.open() — requires canvas context
      try {
        const { WebglAddon } = await import('@xterm/addon-webgl')
        const webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => {
          console.warn('[TerminalView] WebGL context lost, falling back to DOM renderer')
          webglAddon.dispose()
        })
        terminal.loadAddon(webglAddon)
        console.info('[TerminalView] WebGL renderer loaded successfully')
      } catch (err) {
        console.warn('[TerminalView] WebGL addon unavailable, using DOM renderer:', err)
      }

      // TERM-005: Image protocol support (Sixel/iTerm2/Kitty) — opt-in via settings
      const imageEnabled = storeState.imageProtocolEnabled ?? false
      if (imageEnabled) {
        try {
          const { ImageAddon } = await import('@xterm/addon-image')
          terminal.loadAddon(new ImageAddon({
            sixelSupport: true,
            sixelScrolling: true,
            sixelPaletteLimit: 4096,
            showPlaceholder: true,
            enableSizeReports: true,
            storageLimit: MAX_IMAGE_SIZE,
          }))
          console.info('[TerminalView] Image addon loaded (Sixel/iTerm2/Kitty) with %d byte storage limit', MAX_IMAGE_SIZE)
        } catch (err) {
          console.warn('[TerminalView] Image addon unavailable:', err)
        }
      }

      // TERM-007: Serialize addon for session persistence
      try {
        const { SerializeAddon } = await import('@xterm/addon-serialize')
        const serializeAddon = new SerializeAddon()
        terminal.loadAddon(serializeAddon)
        serializeAddonRef.current = serializeAddon
      } catch (err) {
        console.warn('[TerminalView] Serialize addon unavailable:', err)
      }

      // TERM-007: Restore persisted scrollback if available
      if (serializeAddonRef.current) {
        try {
          const sessions = await loadTerminalSessions()
          const saved = sessions.find((s) => s.id === termTabId)
          if (saved) {
            terminal.write(saved.serializedBuffer)
            await deleteTerminalSession(termTabId)
            console.info('[TerminalView] Restored persisted scrollback for', termTabId)
          }
        } catch (err) {
          console.warn('[TerminalView] Failed to restore session:', err)
        }
      }

      terminalRef.current = terminal
      fitAddonRef.current = fitAddon

      // Tab auto-naming via OSC 0/2 title sequences (TERM-003)
      terminal.onTitleChange((title: string) => {
        if (!title || title.trim().length === 0) return
        // Sanitize: strip HTML entities, limit to 100 chars
        const sanitized = title.replace(/[<>&"']/g, '').slice(0, 100)
        if (sanitized.length > 0) {
          useTerminalStore.getState().updateTermTabTitle(termTabId, sanitized)
        }
      })

      // Bell handler (TERM-008)
      terminal.onBell(() => {
        const bellEnabled = useTerminalStore.getState().bellEnabled ?? true
        if (!bellEnabled) return

        // Visual flash for active terminal
        setBellFlash(true)
        setTimeout(() => setBellFlash(false), 100)

        // Increment bell count for background tabs
        if (!isActive) {
          useTerminalStore.getState().incrementBellCount(termTabId)
        }
      })

      // Send keystrokes to main process
      terminal.onData((data: string) => {
        window.clui.terminalWrite(termTabId, data)
      })

      // TERM-011: Forward binary mouse events (X10/normal mouse protocol sends raw bytes)
      // SGR1006 uses text-based encoding (handled by onData above), but legacy mouse
      // protocols (X10, normal, urxvt) may send binary data that onData cannot represent.
      terminal.onBinary((data: string) => {
        const buffer = new Uint8Array(data.length)
        for (let i = 0; i < data.length; i++) {
          buffer[i] = data.charCodeAt(i) & 0xFF
        }
        window.clui.terminalWrite(termTabId, new TextDecoder().decode(buffer))
      })

      // Receive output from main process
      const unsub = window.clui.onTerminalData((id: string, data: string) => {
        if (id === termTabId && terminalRef.current) {
          terminalRef.current.write(data)
        }
      })

      // Send initial resize
      const dims = fitAddon.proposeDimensions()
      if (dims) {
        window.clui.terminalResize(termTabId, dims.cols, dims.rows)
      }

      // Listen for clear, font size, and scrollback events
      const shortcutHandler = (e: Event) => {
        const detail = (e as CustomEvent).detail
        if (detail?.action === 'clear' && terminalRef.current) {
          terminalRef.current.clear()
        }
        if (detail?.action === 'font-size-changed' && terminalRef.current && fitAddonRef.current) {
          terminalRef.current.options.fontSize = detail.fontSize
          fitAddonRef.current.fit()
          const newDims = fitAddonRef.current.proposeDimensions()
          if (newDims) window.clui.terminalResize(termTabId, newDims.cols, newDims.rows)
        }
        if (detail?.action === 'scrollback-changed' && terminalRef.current) {
          terminalRef.current.options.scrollback = detail.scrollbackSize
        }
        if (detail?.action === 'opacity-changed' && terminalRef.current) {
          const scheme = useTerminalStore.getState().terminalScheme ?? 'Default'
          terminalRef.current.options.theme = buildXtermTheme(colors, detail.opacity, scheme)
        }
        if (detail?.action === 'scheme-changed' && terminalRef.current) {
          const opacity = useTerminalStore.getState().backgroundOpacity ?? 1
          terminalRef.current.options.theme = buildXtermTheme(colors, opacity, detail.scheme)
        }
      }
      window.addEventListener('clui-terminal-shortcut', shortcutHandler)

      // TERM-007: Listen for buffer restore events
      const restoreHandler = (e: Event) => {
        const detail = (e as CustomEvent).detail
        if (detail?.termTabId === termTabId && detail?.buffer && terminalRef.current) {
          terminalRef.current.write(detail.buffer)
        }
      }
      window.addEventListener('clui-terminal-restore', restoreHandler)

      // Apply background blur if set
      if (backgroundBlur > 0 && containerRef.current) {
        containerRef.current.style.backdropFilter = `blur(${backgroundBlur}px)`
      }

      setLoaded(true)

      // Store unsub for cleanup
      ;(terminal as any)._cluiUnsub = unsub
      ;(terminal as any)._cluiShortcutHandler = shortcutHandler
      ;(terminal as any)._cluiRestoreHandler = restoreHandler
    }

    init()

    return () => {
      disposed = true
      if (terminalRef.current) {
        // TERM-007: Save scrollback before disposing (prefer addon-serialize over manual buffer read)
        if (serializeAddonRef.current) {
          try {
            const serialized = serializeAddonRef.current.serialize()
            const tab = useTerminalStore.getState().termTabs.find((t) => t.id === termTabId)
            if (serialized && tab) {
              saveTerminalSession({
                id: termTabId,
                serializedBuffer: serialized,
                shell: tab.shell,
                cwd: tab.cwd,
                exitCode: tab.exitCode,
                savedAt: Date.now(),
              }).catch((err) => console.warn('[TerminalView] Failed to save session:', err))
            }
          } catch (err) {
            console.warn('[TerminalView] Failed to serialize terminal:', err)
          }
        } else {
          // Fallback: manual buffer serialization if addon unavailable
          try {
            const buffer = serializeTerminalBuffer(terminalRef.current)
            if (buffer.length > 0) {
              const tab = useTerminalStore.getState().termTabs.find((t) => t.id === termTabId)
              if (tab) {
                saveTerminalSession({
                  id: termTabId,
                  serializedBuffer: buffer,
                  shell: tab.shell,
                  cwd: tab.cwd,
                  exitCode: tab.exitCode,
                  savedAt: Date.now(),
                }).catch((err) => console.warn('[TerminalView] Failed to save session:', err))
              }
            }
          } catch (err) {
            console.warn('[TerminalView] Failed to save session:', err)
          }
        }

        const unsub = (terminalRef.current as any)._cluiUnsub
        if (unsub) unsub()
        const shortcutHandler = (terminalRef.current as any)._cluiShortcutHandler
        if (shortcutHandler) window.removeEventListener('clui-terminal-shortcut', shortcutHandler)
        const restoreHandler = (terminalRef.current as any)._cluiRestoreHandler
        if (restoreHandler) window.removeEventListener('clui-terminal-restore', restoreHandler)
        terminalRef.current.dispose()
        terminalRef.current = null
      }
    }
  }, [termTabId])

  // Re-fit on visibility change and resize
  useEffect(() => {
    if (!isActive || !fitAddonRef.current) return

    const fit = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit()
        const dims = fitAddonRef.current.proposeDimensions()
        if (dims) {
          window.clui.terminalResize(termTabId, dims.cols, dims.rows)
        }
      }
    }

    // Fit when becoming active
    requestAnimationFrame(fit)

    // Fit on window resize
    const observer = new ResizeObserver(fit)
    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    return () => observer.disconnect()
  }, [isActive, termTabId, loaded])

  // Focus terminal when active & clear bell count
  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus()
      useTerminalStore.getState().clearBellCount(termTabId)
    }
  }, [isActive, termTabId])

  // Update theme
  useEffect(() => {
    if (terminalRef.current) {
      const storeState = useTerminalStore.getState()
      const opacity = storeState.backgroundOpacity ?? 1
      const scheme = storeState.terminalScheme ?? 'Default'
      terminalRef.current.options.theme = buildXtermTheme(colors, opacity, scheme)
    }
  }, [colors])

  // Search toggle listener
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.action === 'toggle-search' && detail?.termTabId === termTabId) {
        setSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener('clui-terminal-shortcut', handler)
    return () => window.removeEventListener('clui-terminal-shortcut', handler)
  }, [termTabId])

  // Search handlers — pass the actual search term (fixes TERM-BUG-001)
  const handleSearch = useCallback((term: string, options: { caseSensitive: boolean; regex: boolean }) => {
    if (!searchAddonRef.current) return { resultIndex: -1, resultCount: 0 }
    searchTermRef.current = term

    if (!term.trim()) {
      searchAddonRef.current.clearDecorations()
      setSearchResultIndex(-1)
      setSearchResultCount(0)
      return { resultIndex: -1, resultCount: 0 }
    }

    const found = searchAddonRef.current.findNext(term, {
      caseSensitive: options.caseSensitive,
      regex: options.regex,
      decorations: {
        activeMatchColorOverviewRuler: '#d97757',
        matchOverviewRuler: 'rgba(217,119,87,0.15)',
        activeMatchBackground: 'rgba(217,119,87,0.4)',
        matchBackground: 'rgba(217,119,87,0.15)',
      },
    })

    // Count matches by searching through buffer
    const count = countMatches(terminalRef.current, term, options)
    const idx = found ? 0 : -1
    setSearchResultIndex(idx)
    setSearchResultCount(count)
    return { resultIndex: idx, resultCount: count }
  }, [])

  const handleSearchNext = useCallback((term: string, options: { caseSensitive: boolean; regex: boolean }) => {
    if (!searchAddonRef.current || !term.trim()) return { resultIndex: -1, resultCount: 0 }
    searchTermRef.current = term
    const found = searchAddonRef.current.findNext(term, {
      caseSensitive: options.caseSensitive,
      regex: options.regex,
      incremental: false,
    })
    const count = searchResultCount
    const idx = found ? Math.min(searchResultIndex + 1, count - 1) : -1
    setSearchResultIndex(idx >= count ? 0 : idx)
    return { resultIndex: idx >= count ? 0 : idx, resultCount: count }
  }, [searchResultIndex, searchResultCount])

  const handleSearchPrev = useCallback((term: string, options: { caseSensitive: boolean; regex: boolean }) => {
    if (!searchAddonRef.current || !term.trim()) return { resultIndex: -1, resultCount: 0 }
    searchTermRef.current = term
    const found = searchAddonRef.current.findPrevious(term, {
      caseSensitive: options.caseSensitive,
      regex: options.regex,
    })
    const count = searchResultCount
    const idx = found ? Math.max(searchResultIndex - 1, 0) : -1
    setSearchResultIndex(idx < 0 ? count - 1 : idx)
    return { resultIndex: idx < 0 ? count - 1 : idx, resultCount: count }
  }, [searchResultIndex, searchResultCount])

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false)
    searchTermRef.current = ''
    setSearchResultIndex(-1)
    setSearchResultCount(0)
    if (searchAddonRef.current) searchAddonRef.current.clearDecorations()
    terminalRef.current?.focus()
  }, [])

  // TERM-005: Click-to-expand lightbox for inline terminal images
  const handleCloseLightbox = useCallback(() => setLightboxSrc(null), [])

  const handleTerminalClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target instanceof HTMLImageElement && target.src) {
      e.stopPropagation()
      setLightboxSrc(target.src)
      return
    }
    // Only open lightbox for image-protocol canvases, NOT xterm's own render canvas.
    // xterm.js places its WebGL/canvas renderer inside .xterm-screen — skip those.
    if (target instanceof HTMLCanvasElement && !target.closest('.xterm-screen')) {
      try {
        const dataUrl = target.toDataURL('image/png')
        if (dataUrl && dataUrl !== 'data:,') {
          e.stopPropagation()
          setLightboxSrc(dataUrl)
          return
        }
      } catch (err) {
        console.warn('[TerminalView] Failed to extract canvas image for lightbox:', err)
      }
    }
    terminalRef.current?.focus()
  }, [])

  const backgroundOpacity = useTerminalStore((s) => s.backgroundOpacity) ?? 1

  return (
    <div
      style={{
        flex: 1,
        display: isActive ? 'flex' : 'none',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Bell flash overlay (TERM-008) */}
      {bellFlash && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(255,255,255,0.15)',
            zIndex: 20,
            pointerEvents: 'none',
          }}
        />
      )}

      <AnimatePresence>
        {searchOpen && (
          <TerminalSearch
            onSearch={handleSearch}
            onNext={handleSearchNext}
            onPrev={handleSearchPrev}
            onClose={handleSearchClose}
            resultIndex={searchResultIndex}
            resultCount={searchResultCount}
          />
        )}
      </AnimatePresence>
      {/* TERM-005: Image lightbox overlay */}
      <AnimatePresence>
        {lightboxSrc && (
          <ImageLightbox src={lightboxSrc} onClose={handleCloseLightbox} />
        )}
      </AnimatePresence>
      <div
        ref={containerRef}
        data-clui-ui
        onClick={handleTerminalClick}
        onMouseDown={() => terminalRef.current?.focus()}
        style={{
          flex: 1,
          padding: 4,
          overflow: 'hidden',
          cursor: 'text',
          // Text shadow for readability when opacity is low (TERM-010)
          ...(backgroundOpacity < 0.7 ? { textShadow: '0 0 2px rgba(0,0,0,0.5)' } : {}),
        }}
      />
    </div>
  )
}

/** TERM-005: Click-to-expand lightbox for inline terminal images */
function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const colors = useColors()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        cursor: 'zoom-out',
      }}
    >
      <motion.button
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ duration: 0.15, delay: 0.05 }}
        onClick={(e) => { e.stopPropagation(); onClose() }}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: 'none',
          background: colors.surfacePrimary,
          color: colors.textPrimary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 51,
        }}
        aria-label="Close lightbox"
      >
        <X size={18} weight="bold" />
      </motion.button>
      <motion.img
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={{ duration: 0.2 }}
        src={src}
        alt="Terminal image (expanded)"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '90%',
          maxHeight: '90%',
          objectFit: 'contain',
          borderRadius: 8,
          border: `1px solid ${colors.containerBorder}`,
          boxShadow: colors.containerShadow,
          cursor: 'default',
        }}
      />
    </motion.div>
  )
}

function countMatches(
  terminal: any,
  term: string,
  options: { caseSensitive: boolean; regex: boolean },
): number {
  if (!terminal || !term) return 0
  try {
    const buffer = terminal.buffer?.active
    if (!buffer) return 1
    let count = 0
    const totalLines = buffer.length
    for (let i = 0; i < totalLines; i++) {
      const line = buffer.getLine(i)
      if (!line) continue
      const text = line.translateToString(true)
      if (options.regex) {
        try {
          const re = new RegExp(term, options.caseSensitive ? 'g' : 'gi')
          const m = text.match(re)
          if (m) count += m.length
        } catch {
          // Invalid regex
        }
      } else {
        const searchText = options.caseSensitive ? text : text.toLowerCase()
        const searchTerm = options.caseSensitive ? term : term.toLowerCase()
        let idx = 0
        while ((idx = searchText.indexOf(searchTerm, idx)) !== -1) {
          count++
          idx += searchTerm.length
        }
      }
    }
    return Math.max(count, 0)
  } catch {
    return 1
  }
}

// TERM-007: Serialize terminal buffer content for persistence
function serializeTerminalBuffer(terminal: any): string {
  try {
    const buffer = terminal.buffer?.active
    if (!buffer) return ''
    const lines: string[] = []
    const totalLines = buffer.length
    for (let i = 0; i < totalLines; i++) {
      const line = buffer.getLine(i)
      if (!line) continue
      lines.push(line.translateToString(false))
    }
    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop()
    }
    return lines.join('\r\n')
  } catch (err) {
    console.warn('[TerminalView] Failed to read terminal buffer:', err)
    return ''
  }
}

function buildXtermTheme(colors: ReturnType<typeof useColors>, opacity = 1, schemeName?: string): Record<string, string> {
  const scheme = schemeName && schemeName !== 'Default'
    ? TERMINAL_SCHEMES.find((s) => s.name === schemeName)
    : undefined

  if (scheme) {
    // Use scheme colors, but apply opacity to background
    let background = scheme.colors.background
    if (opacity < 1) {
      const hex = background.replace('#', '')
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      background = `rgba(${r},${g},${b},${Math.max(0.4, opacity)})`
    }
    return {
      background,
      foreground: scheme.colors.foreground,
      cursor: scheme.colors.cursor,
      cursorAccent: scheme.colors.background,
      selectionBackground: scheme.colors.selectionBackground,
      selectionForeground: scheme.colors.foreground,
      black: scheme.colors.black,
      red: scheme.colors.red,
      green: scheme.colors.green,
      yellow: scheme.colors.yellow,
      blue: scheme.colors.blue,
      magenta: scheme.colors.magenta,
      cyan: scheme.colors.cyan,
      white: scheme.colors.white,
      brightBlack: scheme.colors.brightBlack,
      brightRed: scheme.colors.brightRed,
      brightGreen: scheme.colors.brightGreen,
      brightYellow: scheme.colors.brightYellow,
      brightBlue: scheme.colors.brightBlue,
      brightMagenta: scheme.colors.brightMagenta,
      brightCyan: scheme.colors.brightCyan,
      brightWhite: scheme.colors.brightWhite,
    }
  }

  // Default: use app theme colors
  let background = colors.containerBg
  if (opacity < 1) {
    const hex = colors.containerBg.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    background = `rgba(${r},${g},${b},${Math.max(0.4, opacity)})`
  }

  return {
    background,
    foreground: colors.textPrimary,
    cursor: colors.accent,
    cursorAccent: colors.containerBg,
    selectionBackground: colors.accentSoft,
    selectionForeground: colors.textPrimary,
    black: colors.textMuted,
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: colors.textPrimary,
    brightBlack: colors.textTertiary,
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#ffffff',
  }
}
