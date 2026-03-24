// @vitest-environment jsdom

import React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposeEditor } from '../../../src/renderer/components/ComposeEditor'
import { InputBar } from '../../../src/renderer/components/InputBar'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { renderWithProviders, resetTestState, makeTab } from '../testUtils'

describe('ComposeEditor', () => {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    resetTestState()
    onSubmit.mockReset()
    onCancel.mockReset()
  })

  it('renders when open', () => {
    renderWithProviders(
      <ComposeEditor isOpen={true} initialText="" onSubmit={onSubmit} onCancel={onCancel} />,
    )
    expect(screen.getByTestId('compose-editor')).toBeInTheDocument()
    expect(screen.getByTestId('compose-textarea')).toBeInTheDocument()
    expect(screen.getByTestId('compose-top-bar')).toBeInTheDocument()
  })

  it('is hidden when closed', () => {
    renderWithProviders(
      <ComposeEditor isOpen={false} initialText="" onSubmit={onSubmit} onCancel={onCancel} />,
    )
    expect(screen.queryByTestId('compose-editor')).not.toBeInTheDocument()
  })

  it('pre-fills with initialText when opened', () => {
    renderWithProviders(
      <ComposeEditor isOpen={true} initialText="Hello world" onSubmit={onSubmit} onCancel={onCancel} />,
    )
    expect(screen.getByTestId('compose-textarea')).toHaveValue('Hello world')
  })

  it('Escape closes without submitting and preserves draft', () => {
    renderWithProviders(
      <ComposeEditor isOpen={true} initialText="draft text" onSubmit={onSubmit} onCancel={onCancel} />,
    )
    const textarea = screen.getByTestId('compose-textarea')
    fireEvent.keyDown(textarea, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledWith('draft text')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Ctrl+Enter submits and closes', () => {
    renderWithProviders(
      <ComposeEditor isOpen={true} initialText="submit me" onSubmit={onSubmit} onCancel={onCancel} />,
    )
    const textarea = screen.getByTestId('compose-textarea')
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

    expect(onSubmit).toHaveBeenCalledWith('submit me')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('does not submit empty text', () => {
    renderWithProviders(
      <ComposeEditor isOpen={true} initialText="" onSubmit={onSubmit} onCancel={onCancel} />,
    )
    const textarea = screen.getByTestId('compose-textarea')
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not submit when disabled', () => {
    renderWithProviders(
      <ComposeEditor isOpen={true} initialText="text" onSubmit={onSubmit} onCancel={onCancel} disabled />,
    )
    const textarea = screen.getByTestId('compose-textarea')
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows character and line count for initial text', () => {
    act(() => {
      renderWithProviders(
        <ComposeEditor isOpen={true} initialText="" onSubmit={onSubmit} onCancel={onCancel} />,
      )
    })
    const counts = screen.getByTestId('compose-counts')
    expect(counts.textContent).toContain('0 chars')
    expect(counts.textContent).toContain('1 line')
  })

  it('shows correct counts for multi-line initial text', () => {
    act(() => {
      renderWithProviders(
        <ComposeEditor isOpen={true} initialText={'line1\nline2\nline3'} onSubmit={onSubmit} onCancel={onCancel} />,
      )
    })
    const counts = screen.getByTestId('compose-counts')
    expect(counts.textContent).toContain('17 chars')
    expect(counts.textContent).toContain('3 lines')
  })

  it('Cancel button calls onCancel with current text', () => {
    renderWithProviders(
      <ComposeEditor isOpen={true} initialText="some text" onSubmit={onSubmit} onCancel={onCancel} />,
    )
    fireEvent.click(screen.getByTestId('compose-cancel'))

    expect(onCancel).toHaveBeenCalledWith('some text')
  })

  it('Submit button calls onSubmit with trimmed text', () => {
    renderWithProviders(
      <ComposeEditor isOpen={true} initialText="  submit me  " onSubmit={onSubmit} onCancel={onCancel} />,
    )
    fireEvent.click(screen.getByTestId('compose-submit'))

    expect(onSubmit).toHaveBeenCalledWith('submit me')
  })

  it('renders line numbers matching the number of lines', () => {
    act(() => {
      renderWithProviders(
        <ComposeEditor isOpen={true} initialText={'a\nb\nc'} onSubmit={onSubmit} onCancel={onCancel} />,
      )
    })
    const gutter = screen.getByTestId('compose-line-numbers')
    // Initial text "a\nb\nc" has 3 lines
    expect(gutter.children).toHaveLength(3)
    expect(gutter.children[0].textContent).toBe('1')
    expect(gutter.children[2].textContent).toBe('3')
  })
})

describe('ComposeEditor draft persistence', () => {
  beforeEach(() => {
    resetTestState()
    useSessionStore.setState({
      tabs: [
        makeTab({ id: 'tab-1', title: 'Tab 1' }),
        makeTab({ id: 'tab-2', title: 'Tab 2' }),
      ],
      activeTabId: 'tab-1',
      staticInfo: {
        version: '1.0.0',
        email: 'user@example.com',
        subscriptionType: 'pro',
        projectPath: 'C:/repo',
        homePath: 'C:/Users/test',
      },
    })
  })

  it('setComposeDraft stores per-tab draft', () => {
    useSessionStore.getState().setComposeDraft('tab-1', 'draft for tab 1')
    expect(useSessionStore.getState().composeDrafts['tab-1']).toBe('draft for tab 1')
  })

  it('clearComposeDraft removes the draft', () => {
    useSessionStore.getState().setComposeDraft('tab-1', 'draft')
    useSessionStore.getState().clearComposeDraft('tab-1')
    expect(useSessionStore.getState().composeDrafts['tab-1']).toBeUndefined()
  })

  it('drafts are independent per tab', () => {
    useSessionStore.getState().setComposeDraft('tab-1', 'draft A')
    useSessionStore.getState().setComposeDraft('tab-2', 'draft B')
    expect(useSessionStore.getState().composeDrafts['tab-1']).toBe('draft A')
    expect(useSessionStore.getState().composeDrafts['tab-2']).toBe('draft B')
  })

  it('closeTab cleans up the compose draft', () => {
    // Ensure closeTab IPC mock is available
    window.clui = {
      ...window.clui,
      closeTab: vi.fn().mockResolvedValue(undefined),
    } as typeof window.clui
    useSessionStore.getState().setComposeDraft('tab-1', 'draft')
    useSessionStore.getState().closeTab('tab-1')
    expect(useSessionStore.getState().composeDrafts['tab-1']).toBeUndefined()
  })
})

describe('InputBar Ctrl+G integration', () => {
  beforeEach(() => {
    resetTestState()
    useSessionStore.setState({
      tabs: [makeTab({ id: 'tab-1', title: 'Chat' })],
      activeTabId: 'tab-1',
      staticInfo: {
        version: '1.0.0',
        email: 'user@example.com',
        subscriptionType: 'pro',
        projectPath: 'C:/repo',
        homePath: 'C:/Users/test',
      },
    })
  })

  it('Ctrl+G opens compose editor', () => {
    renderWithProviders(<InputBar />)
    expect(screen.queryByTestId('compose-editor')).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'g', ctrlKey: true })
    expect(screen.getByTestId('compose-editor')).toBeInTheDocument()
  })

  it('Ctrl+G toggles compose editor closed when already open', () => {
    renderWithProviders(<InputBar />)

    fireEvent.keyDown(window, { key: 'g', ctrlKey: true })
    expect(screen.getByTestId('compose-editor')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'g', ctrlKey: true })
    expect(screen.queryByTestId('compose-editor')).not.toBeInTheDocument()
  })
})
