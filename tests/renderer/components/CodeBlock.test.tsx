// @vitest-environment jsdom

import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock shiki before importing CodeBlock
const mockHighlightCode = vi.fn()
vi.mock('../../../src/renderer/utils/shiki', () => ({
  highlightCode: (...args: unknown[]) => mockHighlightCode(...args),
}))

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
})

import { CodeBlock } from '../../../src/renderer/components/CodeBlock'

describe('CodeBlock', () => {
  beforeEach(() => {
    mockHighlightCode.mockReset()
    // Default: never resolves (simulates loading state)
    mockHighlightCode.mockReturnValue(new Promise(() => {}))
  })

  it('renders plain code text as fallback before shiki loads', () => {
    render(<CodeBlock code="const x = 1" language="typescript" />)

    expect(screen.getByText('const x = 1')).toBeInTheDocument()
    // Should be inside a <pre><code> fallback
    const codeEl = screen.getByText('const x = 1')
    expect(codeEl.tagName).toBe('CODE')
    expect(codeEl.parentElement?.tagName).toBe('PRE')
  })

  it('displays the language label', () => {
    render(<CodeBlock code="print('hi')" language="python" />)

    expect(screen.getByText('python')).toBeInTheDocument()
  })

  it('displays "text" when no language is provided', () => {
    render(<CodeBlock code="plain text" language="" />)

    expect(screen.getByText('text')).toBeInTheDocument()
  })

  it('has a copy button', () => {
    render(<CodeBlock code="copy me" language="bash" />)

    const copyBtn = screen.getByTitle('Copy code')
    expect(copyBtn).toBeInTheDocument()
  })

  it('calls highlightCode with correct language and isDark', () => {
    render(<CodeBlock code="fn main() {}" language="rust" />)

    expect(mockHighlightCode).toHaveBeenCalledWith('fn main() {}', 'rust', true)
  })

  it('renders highlighted HTML when shiki resolves', async () => {
    const highlightedHtml = '<span class="line"><span style="color:#f97583">const</span> x = 1</span>'
    mockHighlightCode.mockResolvedValue(highlightedHtml)

    render(<CodeBlock code="const x = 1" language="typescript" />)

    // Wait for the async highlight to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    // The highlighted HTML should be rendered via dangerouslySetInnerHTML
    const highlighted = screen.getByTestId('codeblock-highlighted')
    expect(highlighted.innerHTML).toContain('color:#f97583')
  })

  it('keeps showing plain text if highlightCode rejects', async () => {
    mockHighlightCode.mockRejectedValue(new Error('shiki load failed'))

    render(<CodeBlock code="fallback text" language="javascript" />)

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    // Fallback text should still be visible
    expect(screen.getByText('fallback text')).toBeInTheDocument()
  })
})
