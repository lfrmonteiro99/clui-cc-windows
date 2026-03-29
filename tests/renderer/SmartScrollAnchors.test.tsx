// @vitest-environment jsdom

import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SmartScrollAnchors, findLastCodeMessage } from '../../src/renderer/components/SmartScrollAnchors'
import type { Message } from '../../src/shared/types'

function makeMsg(overrides: Partial<Message> & Pick<Message, 'role' | 'content'>): Message {
  return {
    id: overrides.id || crypto.randomUUID(),
    timestamp: overrides.timestamp ?? Date.now(),
    ...overrides,
  }
}

describe('findLastCodeMessage', () => {
  it('finds last assistant message with code block', () => {
    const messages: Message[] = [
      makeMsg({ id: 'msg-1', role: 'user', content: 'hello' }),
      makeMsg({ id: 'msg-2', role: 'assistant', content: 'Here is code:\n```js\nconsole.log("hi")\n```' }),
      makeMsg({ id: 'msg-3', role: 'assistant', content: 'No code here' }),
      makeMsg({ id: 'msg-4', role: 'assistant', content: 'More code:\n```\nfoo\n```' }),
    ]
    expect(findLastCodeMessage(messages)).toBe('msg-4')
  })

  it('returns null when no code blocks', () => {
    const messages: Message[] = [
      makeMsg({ role: 'user', content: 'hello' }),
      makeMsg({ role: 'assistant', content: 'just text' }),
    ]
    expect(findLastCodeMessage(messages)).toBeNull()
  })

  it('ignores user messages with code blocks', () => {
    const messages: Message[] = [
      makeMsg({ role: 'user', content: 'Here is ```code```' }),
      makeMsg({ role: 'assistant', content: 'no code here' }),
    ]
    expect(findLastCodeMessage(messages)).toBeNull()
  })

  it('returns null for empty messages', () => {
    expect(findLastCodeMessage([])).toBeNull()
  })
})

describe('SmartScrollAnchors', () => {
  const scrollRef = { current: document.createElement('div') }

  it('hidden when at bottom (distance < 300)', () => {
    const messages = [makeMsg({ role: 'assistant', content: '```code```' })]
    render(
      <SmartScrollAnchors
        messages={messages}
        scrollRef={scrollRef}
        distanceFromBottom={100}
      />,
    )
    expect(screen.queryByTestId('smart-scroll-anchors')).toBeNull()
  })

  it('visible when scrolled up significantly (distance > 300)', () => {
    const messages = [makeMsg({ role: 'assistant', content: '```code```' })]
    render(
      <SmartScrollAnchors
        messages={messages}
        scrollRef={scrollRef}
        distanceFromBottom={500}
      />,
    )
    expect(screen.getByTestId('smart-scroll-anchors')).toBeDefined()
  })

  it('shows jump-to-code button when code messages exist', () => {
    const messages = [makeMsg({ role: 'assistant', content: '```js\ncode\n```' })]
    render(
      <SmartScrollAnchors
        messages={messages}
        scrollRef={scrollRef}
        distanceFromBottom={500}
      />,
    )
    expect(screen.getByTestId('jump-to-code')).toBeDefined()
  })

  it('hides jump-to-code button when no code messages', () => {
    const messages = [makeMsg({ role: 'assistant', content: 'no code' })]
    render(
      <SmartScrollAnchors
        messages={messages}
        scrollRef={scrollRef}
        distanceFromBottom={500}
      />,
    )
    expect(screen.queryByTestId('jump-to-code')).toBeNull()
    // Jump to bottom should still be there
    expect(screen.getByTestId('jump-to-bottom-anchor')).toBeDefined()
  })
})
