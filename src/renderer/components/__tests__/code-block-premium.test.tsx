/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

// ─── Mocks (must be before imports) ───

const mockColors: Record<string, string> = {
  codeBg: '#1a1a18',
  containerBorder: '#3b3b36',
  textPrimary: '#ccc9c0',
  textTertiary: '#76766e',
  textMuted: '#353530',
  surfaceHover: 'rgba(255, 255, 255, 0.05)',
  statusComplete: '#7aac8c',
  statusCompleteBg: 'rgba(122, 172, 140, 0.1)',
  accent: '#d97757',
}

vi.mock('../../theme', () => ({
  useColors: () => mockColors,
  useThemeStore: (selector: any) => {
    const state = { isDark: true, expandedUI: false }
    return selector ? selector(state) : state
  },
}))

vi.mock('../../utils/shiki', () => ({
  highlightCode: () => Promise.resolve('<pre><code>highlighted</code></pre>'),
}))

// Import after mocks are set up
import { CodeBlock } from '../CodeBlock'

// ─── Helpers ───

function makeCode(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n')
}

// ─── Tests ───

describe('CodeBlock Premium', () => {
  it('shows line numbers when code has more than 10 lines', () => {
    const code = makeCode(15)
    render(<CodeBlock code={code} language="typescript" />)
    const gutter = screen.getByTestId('codeblock-line-numbers')
    expect(gutter).toBeTruthy()
    const numbers = gutter.querySelectorAll('span')
    expect(numbers.length).toBe(15)
  })

  it('does not show line numbers when code has 10 or fewer lines', () => {
    const code = makeCode(10)
    render(<CodeBlock code={code} language="typescript" />)
    expect(screen.queryByTestId('codeblock-line-numbers')).toBeNull()
  })

  it('copy button is always visible (not hidden by default)', () => {
    const code = makeCode(3)
    render(<CodeBlock code={code} language="typescript" />)
    const copyBtn = screen.getByTestId('codeblock-copy-btn')
    expect(copyBtn).toBeTruthy()
  })

  it('applies max-height for long code blocks', () => {
    const code = makeCode(50)
    render(<CodeBlock code={code} language="typescript" />)
    const codeArea = screen.getByTestId('codeblock-code-area')
    expect(codeArea.style.maxHeight).toBe('400px')
  })

  it('shows expand button when code exceeds max-height threshold', () => {
    const code = makeCode(50)
    render(<CodeBlock code={code} language="typescript" />)
    const expandBtn = screen.getByTestId('codeblock-expand-btn')
    expect(expandBtn).toBeTruthy()
  })

  it('removes max-height cap when expand button is clicked', () => {
    const code = makeCode(50)
    render(<CodeBlock code={code} language="typescript" />)
    const expandBtn = screen.getByTestId('codeblock-expand-btn')
    fireEvent.click(expandBtn)
    const codeArea = screen.getByTestId('codeblock-code-area')
    expect(codeArea.style.maxHeight).toBe('')
  })

  it('displays language label in header', () => {
    render(<CodeBlock code="const x = 1;" language="typescript" />)
    const header = screen.getByTestId('codeblock-header')
    expect(header.textContent).toContain('typescript')
  })
})
