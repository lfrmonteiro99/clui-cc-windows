// @vitest-environment jsdom

import React from 'react'
import { screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CompanionMessage } from '../../src/renderer/components/CompanionMessage'
import { useSessionStore } from '../../src/renderer/stores/sessionStore'
import { renderWithProviders, resetTestState, installCluiMock, makeTab, makeMessage } from './testUtils'

describe('CompanionMessage', () => {
  beforeEach(() => {
    resetTestState()
    installCluiMock({} as any)
  })

  const companionMsg = makeMessage({
    role: 'system',
    content: 'The agent is reading configuration files to understand the project structure.',
    isCompanion: true,
  })

  it('renders with lightbulb icon', () => {
    renderWithProviders(<CompanionMessage message={companionMsg} />)

    expect(screen.getByTestId('companion-message')).toBeInTheDocument()
    expect(screen.getByText(/reading configuration files/)).toBeInTheDocument()
  })

  it('has distinct styling from SystemMessage', () => {
    renderWithProviders(<CompanionMessage message={companionMsg} />)

    const el = screen.getByTestId('companion-message')
    // Should have italic styling
    expect(el.style.fontStyle).toBe('italic')
  })

  it('renders dismiss button', () => {
    renderWithProviders(<CompanionMessage message={companionMsg} />)

    expect(screen.getByLabelText('Dismiss companion message')).toBeInTheDocument()
  })

  it('calls dismissCompanionMessage on dismiss click', () => {
    const tab = makeTab({
      messages: [companionMsg],
    })
    useSessionStore.setState({
      tabs: [tab],
      activeTabId: tab.id,
    })

    renderWithProviders(<CompanionMessage message={companionMsg} />)

    const dismissBtn = screen.getByLabelText('Dismiss companion message')
    fireEvent.click(dismissBtn)

    // After dismiss, the message should be removed from the tab
    const state = useSessionStore.getState()
    const updatedTab = state.tabs.find((t) => t.id === tab.id)
    expect(updatedTab?.messages).toHaveLength(0)
  })

  it('has animation wrapper', () => {
    const { container } = renderWithProviders(<CompanionMessage message={companionMsg} />)

    // framer-motion wraps in a div with style
    const motionDiv = container.firstChild as HTMLElement
    expect(motionDiv).toBeTruthy()
    expect(motionDiv.className).toContain('text-center')
  })
})
