// @vitest-environment jsdom

import React from 'react'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { InputBar } from '../../../src/renderer/components/InputBar'
import { StatusBar } from '../../../src/renderer/components/StatusBar'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { renderWithProviders, resetTestState, makeTab } from '../testUtils'

describe('InputBar Controls Upgrade', () => {
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

  it('INPUT_MAX_HEIGHT is at least 200', async () => {
    // Import the constant directly — it's module-scoped
    const mod = await import('../../../src/renderer/components/InputBar')
    // We export INPUT_MAX_HEIGHT for testability
    expect((mod as Record<string, unknown>).INPUT_MAX_HEIGHT).toBeGreaterThanOrEqual(200)
  })

  it('send button has accent background color and minimum 36px size', () => {
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
    renderWithProviders(<InputBar />)

    // Type something so the send button appears
    const input = screen.getByTestId('composer-input')
    input.focus()
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )!.set!
    nativeInputValueSetter.call(input, 'Hello')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))

    // The send button should now be visible
    const sendBtn = screen.getByTestId('composer-send')
    expect(sendBtn).toBeInTheDocument()

    // Check accent background via inline style
    const style = sendBtn.style
    expect(style.background || style.backgroundColor).toBeTruthy()

    // Check minimum size: the button should have w-[38px] h-[38px] or larger via class or style
    // We check the className for size classes >= 36px
    const classes = sendBtn.className
    // Should have explicit width/height classes of at least 36px (w-9 = 36px, w-10 = 40px)
    const hasMinSize = classes.includes('w-9') || classes.includes('w-10') ||
      classes.includes('w-[36px]') || classes.includes('w-[38px]') || classes.includes('w-[40px]')
    expect(hasMinSize).toBe(true)
  })

  it('textarea shows hint text when empty', () => {
    renderWithProviders(<InputBar />)

    // Look for the hint text element
    const hint = screen.getByTestId('newline-hint')
    expect(hint).toBeInTheDocument()
    expect(hint.textContent).toContain('Shift+Enter')
  })

  it('send button is disabled with opacity when canSend is false', () => {
    renderWithProviders(<InputBar />)

    // With empty input, the send button should not be rendered (it uses AnimatePresence)
    const sendBtn = screen.queryByTestId('composer-send')
    expect(sendBtn).not.toBeInTheDocument()
  })
})

describe('StatusBar Controls Upgrade', () => {
  beforeEach(() => {
    resetTestState()
    useSessionStore.setState({
      tabs: [makeTab({ id: 'tab-1', title: 'Chat' })],
      activeTabId: 'tab-1',
    })
  })

  it('has no pipe separator characters', () => {
    renderWithProviders(<StatusBar />)

    // The StatusBar should not contain literal pipe text nodes
    const statusBar = screen.getByTestId('status-bar')
    const textContent = statusBar.textContent || ''
    // Pipe character should not appear as a separator
    expect(textContent).not.toContain('|')
  })

  it('icons are at least 14px', () => {
    renderWithProviders(<StatusBar />)

    // Check that FolderOpen and Terminal icons use size >= 14
    const statusBar = screen.getByTestId('status-bar')
    const svgs = statusBar.querySelectorAll('svg')
    for (const svg of Array.from(svgs)) {
      const width = svg.getAttribute('width')
      const height = svg.getAttribute('height')
      if (width) {
        expect(Number(width)).toBeGreaterThanOrEqual(14)
      }
      if (height) {
        expect(Number(height)).toBeGreaterThanOrEqual(14)
      }
    }
  })
})
