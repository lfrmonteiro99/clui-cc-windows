// @vitest-environment jsdom

import React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileContextMenu } from '../../../src/renderer/components/FileContextMenu'
import { useContextMenuStore } from '../../../src/renderer/stores/contextMenuStore'
import { useFilePeekStore } from '../../../src/renderer/stores/filePeekStore'
import { renderWithProviders, resetTestState } from '../testUtils'

const DEFAULT_ITEMS = [
  { id: 'peek', label: 'Peek File', icon: 'Eye', shortcut: 'Ctrl+Click' },
  { id: 'copy-path', label: 'Copy Path', icon: 'Copy' },
  { id: 'reveal', label: 'Reveal in Explorer', icon: 'FolderOpen' },
  { id: 'open-external', label: 'Open in Editor', icon: 'ArrowSquareOut' },
]

function openMenu() {
  useContextMenuStore.setState({
    isOpen: true,
    position: { x: 100, y: 100 },
    filePath: 'src/main/index.ts',
    workingDirectory: 'C:/repo',
    items: DEFAULT_ITEMS,
    focusedIndex: -1,
  })
}

describe('FileContextMenu', () => {
  beforeEach(() => {
    resetTestState()
    // Mock clipboard
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    // Mock window.clui file methods
    window.clui = {
      ...window.clui,
      fileReveal: vi.fn().mockResolvedValue(true),
      fileOpenExternal: vi.fn().mockResolvedValue(true),
    } as typeof window.clui
  })

  it('renders nothing when isOpen is false', () => {
    useContextMenuStore.setState({ isOpen: false })
    const { container } = renderWithProviders(<FileContextMenu />)
    expect(container.querySelector('[data-clui-ui]')).toBeNull()
  })

  it('renders menu items when isOpen is true', () => {
    openMenu()
    renderWithProviders(<FileContextMenu />)
    expect(screen.getByText('Peek File')).toBeInTheDocument()
    expect(screen.getByText('Copy Path')).toBeInTheDocument()
  })

  it('shows all 4 items: Peek File, Copy Path, Reveal, Open in Editor', () => {
    openMenu()
    renderWithProviders(<FileContextMenu />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(4)
    expect(screen.getByText('Peek File')).toBeInTheDocument()
    expect(screen.getByText('Copy Path')).toBeInTheDocument()
    expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument()
    expect(screen.getByText('Open in Editor')).toBeInTheDocument()
  })

  it('clicking Peek File calls openPeek and closes menu', () => {
    openMenu()
    const mockOpenPeek = vi.fn()
    useFilePeekStore.setState({ openPeek: mockOpenPeek })

    renderWithProviders(<FileContextMenu />)
    fireEvent.click(screen.getByText('Peek File'))

    expect(mockOpenPeek).toHaveBeenCalledWith('src/main/index.ts', 'C:/repo', undefined, undefined)
    expect(useContextMenuStore.getState().isOpen).toBe(false)
  })

  it('clicking Copy Path copies to clipboard and closes menu', () => {
    openMenu()
    renderWithProviders(<FileContextMenu />)
    fireEvent.click(screen.getByText('Copy Path'))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('src/main/index.ts')
    expect(useContextMenuStore.getState().isOpen).toBe(false)
  })

  it('clicking Reveal calls fileReveal and closes menu', () => {
    openMenu()
    renderWithProviders(<FileContextMenu />)
    fireEvent.click(screen.getByText('Reveal in Explorer'))

    expect(window.clui.fileReveal).toHaveBeenCalledWith('src/main/index.ts', 'C:/repo', undefined, undefined)
    expect(useContextMenuStore.getState().isOpen).toBe(false)
  })

  it('clicking Open in Editor calls fileOpenExternal and closes menu', () => {
    openMenu()
    renderWithProviders(<FileContextMenu />)
    fireEvent.click(screen.getByText('Open in Editor'))

    expect(window.clui.fileOpenExternal).toHaveBeenCalledWith('src/main/index.ts', 'C:/repo', undefined, undefined)
    expect(useContextMenuStore.getState().isOpen).toBe(false)
  })

  it('Escape key closes the menu', () => {
    openMenu()
    renderWithProviders(<FileContextMenu />)

    // The component uses document-level capture listener
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(useContextMenuStore.getState().isOpen).toBe(false)
  })

  it('click outside closes the menu', () => {
    openMenu()
    renderWithProviders(<FileContextMenu />)

    // mousedown outside the menu triggers close
    fireEvent.mouseDown(document.body)

    expect(useContextMenuStore.getState().isOpen).toBe(false)
  })

  it('ArrowDown changes focused index', () => {
    openMenu()
    renderWithProviders(<FileContextMenu />)

    // focusedIndex starts at -1
    expect(useContextMenuStore.getState().focusedIndex).toBe(-1)

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(useContextMenuStore.getState().focusedIndex).toBe(0)

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(useContextMenuStore.getState().focusedIndex).toBe(1)
  })

  it('ArrowUp changes focused index', () => {
    openMenu()
    useContextMenuStore.setState({ focusedIndex: 2 })
    renderWithProviders(<FileContextMenu />)

    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(useContextMenuStore.getState().focusedIndex).toBe(1)
  })

  it('ArrowUp does not go below 0', () => {
    openMenu()
    useContextMenuStore.setState({ focusedIndex: 0 })
    renderWithProviders(<FileContextMenu />)

    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(useContextMenuStore.getState().focusedIndex).toBe(0)
  })

  it('ArrowDown does not exceed last index', () => {
    openMenu()
    useContextMenuStore.setState({ focusedIndex: 3 })
    renderWithProviders(<FileContextMenu />)

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(useContextMenuStore.getState().focusedIndex).toBe(3)
  })
})
