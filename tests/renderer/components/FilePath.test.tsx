// @vitest-environment jsdom

import React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FilePath } from '../../../src/renderer/components/FilePath'
import { useFilePeekStore } from '../../../src/renderer/stores/filePeekStore'
import { useContextMenuStore } from '../../../src/renderer/stores/contextMenuStore'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { renderWithProviders, resetTestState, makeTab } from '../testUtils'

describe('FilePath', () => {
  const mockOpenPeek = vi.fn()
  const mockOpenMenu = vi.fn()

  beforeEach(() => {
    resetTestState()
    useFilePeekStore.setState({ openPeek: mockOpenPeek })
    useContextMenuStore.setState({ openMenu: mockOpenMenu })
    useSessionStore.setState({
      tabs: [makeTab({ id: 'tab-1', workingDirectory: 'C:/repo' })],
      tabOrder: ['tab-1'],
      activeTabId: 'tab-1',
    })
    mockOpenPeek.mockClear()
    mockOpenMenu.mockClear()
  })

  it('renders the display name when provided', () => {
    renderWithProviders(<FilePath path="src/main/index.ts" displayName="index.ts" />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  it('renders the path when no display name', () => {
    renderWithProviders(<FilePath path="src/main/index.ts" />)
    expect(screen.getByText('src/main/index.ts')).toBeInTheDocument()
  })

  it('has role="button" and aria-label', () => {
    renderWithProviders(<FilePath path="src/main/index.ts" />)
    const el = screen.getByRole('button', { name: /Peek file src\/main\/index\.ts/ })
    expect(el).toBeInTheDocument()
  })

  it('has title attribute with full path', () => {
    renderWithProviders(<FilePath path="src/main/index.ts" />)
    const el = screen.getByRole('button')
    expect(el).toHaveAttribute('title', 'src/main/index.ts')
  })

  it('calls openPeek on Ctrl+Click', () => {
    renderWithProviders(<FilePath path="src/main/index.ts" />)
    const el = screen.getByRole('button')
    fireEvent.click(el, { ctrlKey: true })
    expect(mockOpenPeek).toHaveBeenCalledWith('src/main/index.ts', 'C:/repo')
  })

  it('calls openMenu on right-click (contextmenu event)', () => {
    renderWithProviders(<FilePath path="src/main/index.ts" />)
    const el = screen.getByRole('button')
    fireEvent.contextMenu(el, { clientX: 100, clientY: 200 })
    expect(mockOpenMenu).toHaveBeenCalledWith(
      { x: 100, y: 200 },
      'src/main/index.ts',
      'C:/repo',
    )
  })

  it('does NOT call openPeek on plain click (no modifier)', () => {
    renderWithProviders(<FilePath path="src/main/index.ts" />)
    const el = screen.getByRole('button')
    fireEvent.click(el)
    expect(mockOpenPeek).not.toHaveBeenCalled()
  })

  it('calls openPeek on Enter key', () => {
    renderWithProviders(<FilePath path="src/main/index.ts" />)
    const el = screen.getByRole('button')
    fireEvent.keyDown(el, { key: 'Enter' })
    expect(mockOpenPeek).toHaveBeenCalledWith('src/main/index.ts', 'C:/repo')
  })
})
