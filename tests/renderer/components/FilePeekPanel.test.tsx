// @vitest-environment jsdom

import React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FilePeekPanel } from '../../../src/renderer/components/FilePeekPanel'
import { useFilePeekStore } from '../../../src/renderer/stores/filePeekStore'
import { useContextMenuStore } from '../../../src/renderer/stores/contextMenuStore'
import { renderWithProviders, resetTestState } from '../testUtils'

// Mock shiki to avoid WASM issues in test environment
vi.mock('../../../src/renderer/utils/shiki', () => ({
  highlightCode: vi.fn().mockResolvedValue('<pre class="shiki"><code>highlighted</code></pre>'),
}))

function setOpenWithContent(overrides: Partial<ReturnType<typeof useFilePeekStore.getState>> = {}) {
  const closePeek = vi.fn(() => {
    useFilePeekStore.setState({ isOpen: false })
  })
  useFilePeekStore.setState({
    isOpen: true,
    displayPath: 'src/main/index.ts',
    content: 'const x = 1;\nconst y = 2;',
    language: 'typescript',
    lineCount: 2,
    truncated: false,
    fileSize: 26,
    loading: false,
    error: null,
    errorType: null,
    closePeek,
    ...overrides,
  })
  return { closePeek }
}

describe('FilePeekPanel', () => {
  beforeEach(() => {
    resetTestState()
    // Reset filePeekStore to its defaults
    useFilePeekStore.setState({
      isOpen: false,
      filePath: null,
      displayPath: null,
      content: null,
      language: null,
      lineCount: 0,
      truncated: false,
      fileSize: 0,
      loading: false,
      error: null,
      errorType: null,
    })
  })

  it('renders nothing when isOpen is false', () => {
    useFilePeekStore.setState({ isOpen: false })
    const { container } = renderWithProviders(<FilePeekPanel />)
    expect(container.querySelector('[data-clui-ui]')).toBeNull()
  })

  it('shows loading skeleton when loading is true', () => {
    setOpenWithContent({ loading: true, content: null })
    const { container } = renderWithProviders(<FilePeekPanel />)
    const pulseElements = container.querySelectorAll('.animate-pulse')
    expect(pulseElements.length).toBeGreaterThanOrEqual(1)
  })

  it('shows error message for not_found', () => {
    setOpenWithContent({
      content: null,
      error: 'File not found: test.ts',
      errorType: 'not_found',
    })
    renderWithProviders(<FilePeekPanel />)
    expect(screen.getByText('File not found')).toBeInTheDocument()
  })

  it('shows error message for too_large', () => {
    setOpenWithContent({
      content: null,
      error: 'File is 2.5MB',
      errorType: 'too_large',
    })
    renderWithProviders(<FilePeekPanel />)
    expect(screen.getByText('File is too large to preview')).toBeInTheDocument()
  })

  it('shows error message for binary', () => {
    setOpenWithContent({
      content: null,
      error: 'Binary file',
      errorType: 'binary',
    })
    renderWithProviders(<FilePeekPanel />)
    expect(screen.getByText('Binary files cannot be previewed')).toBeInTheDocument()
  })

  it('shows error message for permission_denied', () => {
    setOpenWithContent({
      content: null,
      error: 'Permission denied',
      errorType: 'permission_denied',
    })
    renderWithProviders(<FilePeekPanel />)
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
  })

  it('shows error message for outside_workspace', () => {
    setOpenWithContent({
      content: null,
      error: 'Outside workspace',
      errorType: 'outside_workspace',
    })
    renderWithProviders(<FilePeekPanel />)
    expect(screen.getByText('File is outside the workspace')).toBeInTheDocument()
  })

  it('shows file content when loaded', () => {
    setOpenWithContent()
    const { container } = renderWithProviders(<FilePeekPanel />)
    // Content is inside a <pre> tag as a single text node with newlines
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toContain('const x = 1;')
    expect(pre!.textContent).toContain('const y = 2;')
  })

  it('shows header with display path and metadata', () => {
    setOpenWithContent({
      displayPath: 'src/main/index.ts',
      language: 'typescript',
      lineCount: 42,
      fileSize: 1500,
    })
    renderWithProviders(<FilePeekPanel />)
    expect(screen.getByText('src/main/index.ts')).toBeInTheDocument()
    expect(screen.getByText('typescript')).toBeInTheDocument()
    expect(screen.getByText('42 lines')).toBeInTheDocument()
    expect(screen.getByText('1.5 KB')).toBeInTheDocument()
  })

  it('shows truncation footer when truncated is true', () => {
    setOpenWithContent({
      truncated: true,
      lineCount: 5000,
      fileSize: 95000,
    })
    renderWithProviders(<FilePeekPanel />)
    expect(screen.getByText(/File truncated/)).toBeInTheDocument()
    expect(screen.getByText(/showing first 5000 lines/)).toBeInTheDocument()
  })

  it('does not show truncation footer when truncated is false', () => {
    setOpenWithContent({ truncated: false })
    renderWithProviders(<FilePeekPanel />)
    expect(screen.queryByText(/File truncated/)).not.toBeInTheDocument()
  })

  it('close button calls closePeek', () => {
    const { closePeek } = setOpenWithContent()
    renderWithProviders(<FilePeekPanel />)
    const closeBtn = screen.getByRole('button', { name: /Close peek panel/i })
    fireEvent.click(closeBtn)
    expect(closePeek).toHaveBeenCalled()
  })

  it('Escape key calls closePeek when context menu is closed', () => {
    const { closePeek } = setOpenWithContent()
    useContextMenuStore.setState({ isOpen: false })
    renderWithProviders(<FilePeekPanel />)

    // The component listens on document with capture
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(closePeek).toHaveBeenCalled()
  })

  it('does NOT close on Escape when context menu is open', () => {
    const { closePeek } = setOpenWithContent()
    useContextMenuStore.setState({ isOpen: true })
    renderWithProviders(<FilePeekPanel />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(closePeek).not.toHaveBeenCalled()
  })
})
