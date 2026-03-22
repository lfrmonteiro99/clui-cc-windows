// @vitest-environment jsdom

import React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { PromptLintBar } from '../../../src/renderer/components/PromptLintBar'
import type { PromptLintWarning } from '../../../src/shared/prompt-linter'
import { renderWithProviders, resetTestState } from '../testUtils'

const makeWarning = (overrides: Partial<PromptLintWarning> = {}): PromptLintWarning => ({
  id: overrides.id || 'test-warning',
  severity: overrides.severity || 'warning',
  message: overrides.message || 'Test warning message',
  suggestion: overrides.suggestion,
})

describe('PromptLintBar', () => {
  beforeEach(() => {
    resetTestState()
  })

  it('renders nothing when there are no warnings', () => {
    const { container } = renderWithProviders(<PromptLintBar warnings={[]} />)
    expect(container.querySelector('[data-testid="prompt-lint-bar"]')).toBeNull()
  })

  it('renders warning pills for each warning', () => {
    const warnings = [
      makeWarning({ id: 'ambiguous-scope', message: 'Ambiguous reference' }),
      makeWarning({ id: 'broad-scope', message: 'Very broad scope' }),
    ]

    renderWithProviders(<PromptLintBar warnings={warnings} />)

    expect(screen.getByTestId('prompt-lint-bar')).toBeInTheDocument()
    expect(screen.getByTestId('lint-warning-ambiguous-scope')).toBeInTheDocument()
    expect(screen.getByTestId('lint-warning-broad-scope')).toBeInTheDocument()
    expect(screen.getByText('Ambiguous reference')).toBeInTheDocument()
    expect(screen.getByText('Very broad scope')).toBeInTheDocument()
  })

  it('dismisses a warning when the X button is clicked', () => {
    const warnings = [
      makeWarning({ id: 'ambiguous-scope', message: 'Ambiguous reference' }),
      makeWarning({ id: 'broad-scope', message: 'Very broad scope' }),
    ]

    renderWithProviders(<PromptLintBar warnings={warnings} />)

    fireEvent.click(screen.getByTestId('lint-dismiss-ambiguous-scope'))

    expect(screen.queryByTestId('lint-warning-ambiguous-scope')).toBeNull()
    expect(screen.getByTestId('lint-warning-broad-scope')).toBeInTheDocument()
  })

  it('hides the entire bar when all warnings are dismissed', () => {
    const warnings = [makeWarning({ id: 'single-warning', message: 'Only one' })]

    renderWithProviders(<PromptLintBar warnings={warnings} />)

    expect(screen.getByTestId('prompt-lint-bar')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('lint-dismiss-single-warning'))

    expect(screen.queryByTestId('prompt-lint-bar')).toBeNull()
  })
})
