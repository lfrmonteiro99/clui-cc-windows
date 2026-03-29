// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EnrichedText } from '../../src/renderer/components/EnrichedText'

// Mock window.clui
beforeEach(() => {
  window.clui = {
    openExternal: vi.fn().mockResolvedValue(true),
  } as unknown as typeof window.clui
})

// Mock the theme hook to return test colors
vi.mock('../../src/renderer/theme', () => ({
  useColors: () => ({
    accent: '#007aff',
    border: '#333',
    textSecondary: '#888',
    textTertiary: '#666',
  }),
  useThemeStore: vi.fn(() => ({ isDark: true })),
}))

// Mock FilePath to simplify testing
vi.mock('../../src/renderer/components/FilePath', () => ({
  FilePath: ({ path, displayName }: { path: string; displayName: string }) => (
    <span data-testid="file-path">{displayName || path}</span>
  ),
}))

describe('EnrichedText', () => {
  it('renders plain text without references normally', () => {
    const { container } = render(<EnrichedText text="Just plain text" />)
    expect(container.textContent).toBe('Just plain text')
  })

  it('renders URLs as clickable spans', () => {
    render(<EnrichedText text="Visit https://example.com for more" />)
    const link = screen.getByRole('link')
    expect(link).toHaveTextContent('https://example.com')
    expect(link).toHaveAttribute('title', 'https://example.com')
  })

  it('renders file paths using FilePath component', () => {
    render(<EnrichedText text="Edit ./src/main.ts now" />)
    const fp = screen.getByTestId('file-path')
    expect(fp).toHaveTextContent('./src/main.ts')
  })

  it('renders GitHub refs as clickable spans', () => {
    render(<EnrichedText text="Fixed in #42" />)
    const link = screen.getByRole('link')
    expect(link).toHaveTextContent('#42')
    expect(link).toHaveAttribute('title', 'Open #42 on GitHub')
  })

  it('renders color swatches for hex colors', () => {
    render(<EnrichedText text="Use #ff0000 for red" />)
    const swatch = screen.getByTestId('color-swatch')
    expect(swatch).toHaveStyle({ backgroundColor: '#ff0000' })
  })

  it('handles mixed content with multiple reference types', () => {
    render(<EnrichedText text="Fix #42 and use #ff0000 at https://example.com" />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2) // #42 and URL
    expect(screen.getByTestId('color-swatch')).toBeInTheDocument()
  })
})
