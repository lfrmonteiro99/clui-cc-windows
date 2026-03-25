/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

// ─── Mocks (must be before component imports) ───

const mockColors: Record<string, string> = {
  accent: '#d97757',
  accentSoft: 'rgba(217, 119, 87, 0.15)',
  textPrimary: '#ccc9c0',
  textSecondary: '#c0bdb2',
  textTertiary: '#76766e',
  textMuted: '#353530',
  statusComplete: '#7aac8c',
  statusCompleteBg: 'rgba(122, 172, 140, 0.1)',
  surfaceHover: 'rgba(255, 255, 255, 0.05)',
}

vi.mock('../../theme', () => ({
  useColors: () => mockColors,
}))

const mockOpenPeek = vi.fn()
vi.mock('../../stores/filePeekStore', () => ({
  useFilePeekStore: (selector: any) => {
    const state = { openPeek: mockOpenPeek }
    return selector(state)
  },
}))

const mockOpenMenu = vi.fn()
vi.mock('../../stores/contextMenuStore', () => ({
  useContextMenuStore: (selector: any) => {
    const state = { openMenu: mockOpenMenu }
    return selector(state)
  },
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', workingDirectory: '/project', runtime: undefined, wslDistro: null }],
    }),
  },
}))

import { FilePath } from '../FilePath'

// ─── Helpers ───

let clipboardWriteTextSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  clipboardWriteTextSpy = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: clipboardWriteTextSpy },
    writable: true,
    configurable: true,
  })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─── Tests ───

describe('FilePath — clickable file paths (UX-008)', () => {
  it('renders with monospace font', () => {
    render(<FilePath path="/src/index.ts" displayName="index.ts" />)
    const el = screen.getByRole('button')
    expect(el.className).toContain('font-mono')
  })

  it('renders with accent color styling', () => {
    render(<FilePath path="/src/index.ts" displayName="index.ts" />)
    const el = screen.getByRole('button')
    // Browser normalizes hex to rgb
    expect(el.style.color).toBe('rgb(217, 119, 87)')
  })

  it('has dashed underline for visual distinction', () => {
    render(<FilePath path="/src/index.ts" displayName="index.ts" />)
    const el = screen.getByRole('button')
    expect(el.style.borderBottom).toContain('dashed')
  })

  it('click copies path to clipboard', async () => {
    render(<FilePath path="/src/components/App.tsx" displayName="App.tsx" />)
    const el = screen.getByRole('button')

    await act(async () => {
      fireEvent.click(el)
    })

    expect(clipboardWriteTextSpy).toHaveBeenCalledWith('/src/components/App.tsx')
  })

  it('shows "Copied!" feedback after click', async () => {
    render(<FilePath path="/src/index.ts" displayName="index.ts" />)
    const el = screen.getByRole('button')

    await act(async () => {
      fireEvent.click(el)
    })

    // "Copied!" tooltip should appear
    const tooltip = screen.getByTestId('file-path-copied-tooltip')
    expect(tooltip).toBeTruthy()
    expect(tooltip.textContent).toContain('Copied')
  })

  it('"Copied!" feedback disappears after timeout', async () => {
    render(<FilePath path="/src/index.ts" displayName="index.ts" />)
    const el = screen.getByRole('button')

    await act(async () => {
      fireEvent.click(el)
    })

    expect(screen.getByTestId('file-path-copied-tooltip')).toBeTruthy()

    // Advance past the feedback timeout (1.5s)
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(screen.queryByTestId('file-path-copied-tooltip')).toBeNull()
  })

  it('Ctrl+Click opens file peek instead of copying', async () => {
    render(<FilePath path="/src/index.ts" displayName="index.ts" />)
    const el = screen.getByRole('button')

    await act(async () => {
      fireEvent.click(el, { ctrlKey: true })
    })

    // Should NOT copy
    expect(clipboardWriteTextSpy).not.toHaveBeenCalled()
    // Should open peek
    expect(mockOpenPeek).toHaveBeenCalledWith('/src/index.ts', '/project', undefined, undefined)
  })

  it('Meta+Click (macOS Cmd) opens file peek instead of copying', async () => {
    render(<FilePath path="/src/index.ts" displayName="index.ts" />)
    const el = screen.getByRole('button')

    await act(async () => {
      fireEvent.click(el, { metaKey: true })
    })

    expect(clipboardWriteTextSpy).not.toHaveBeenCalled()
    expect(mockOpenPeek).toHaveBeenCalled()
  })

  it('displays the displayName text content', () => {
    render(<FilePath path="/src/components/LongFileName.tsx" displayName="LongFileName.tsx" />)
    const el = screen.getByRole('button')
    expect(el.textContent).toContain('LongFileName.tsx')
  })

  it('shows full path as title attribute for tooltip', () => {
    render(<FilePath path="/src/components/App.tsx" displayName="App.tsx" />)
    const el = screen.getByRole('button')
    expect(el.getAttribute('title')).toBe('/src/components/App.tsx')
  })
})
