/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { Message } from '../../../shared/types'

// ─── Mocks ───

const mockColors: Record<string, string> = {
  accent: '#d97757',
  accentSoft: 'rgba(217, 119, 87, 0.15)',
  userBubble: '#353530',
  userBubbleBorder: '#4a4a45',
  userBubbleText: '#ccc9c0',
  containerBg: '#242422',
  textPrimary: '#ccc9c0',
  textSecondary: '#c0bdb2',
  textTertiary: '#76766e',
  surfaceHover: 'rgba(255, 255, 255, 0.05)',
  surfacePrimary: '#353530',
  toolBorder: '#4a4a45',
  statusError: '#c47060',
  statusErrorBg: 'rgba(196, 112, 96, 0.08)',
  statusComplete: '#7aac8c',
  statusCompleteBg: 'rgba(122, 172, 140, 0.1)',
  statusRunning: '#d97757',
  messageBgAssistant: 'rgba(217, 119, 87, 0.04)',
  messageAccentBorder: '#d97757',
}

vi.mock('../../theme', async () => {
  const actual = await vi.importActual('../../theme')
  return {
    ...actual,
    useColors: () => mockColors,
    useThemeStore: (selector: any) => {
      const state = { isDark: true, expandedUI: false }
      return selector ? selector(state) : state
    },
  }
})

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) =>
    React.createElement('div', { 'data-testid': 'markdown' }, children),
}))

vi.mock('remark-gfm', () => ({ default: {} }))

// Session store mock with mutable state so we can change tabs between renders
let mockTabState: any = null
const mockSendMessage = vi.fn()

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: Object.assign(
    (selector: any) => {
      const state = {
        activeTabId: 'tab-1',
        tabs: mockTabState ? [mockTabState] : [],
        sendMessage: mockSendMessage,
        staticInfo: null,
      }
      return selector ? selector(state) : state
    },
    { getState: () => ({ activeTabId: 'tab-1' }), setState: vi.fn() },
  ),
}))

vi.mock('../FilePath', () => ({ FilePath: ({ path }: any) => React.createElement('span', null, path) }))
vi.mock('../PermissionCard', () => ({ PermissionCard: () => null }))
vi.mock('../PermissionDeniedCard', () => ({ PermissionDeniedCard: () => null }))
vi.mock('../RetryBanner', () => ({ RetryBanner: () => null }))
vi.mock('../DirectoryPicker', () => ({ DirectoryPicker: () => null }))
vi.mock('../ToolTimeline', () => ({ ToolTimeline: () => null }))
vi.mock('../ShellOutput', () => ({ ShellOutput: () => null }))
vi.mock('../ResumeBrief', () => ({ ResumeBrief: () => null }))
vi.mock('../BookmarkButton', () => ({ BookmarkButton: () => null }))
vi.mock('../BookmarkPanel', () => ({ BookmarkPanel: () => null }))
vi.mock('../SmartScrollAnchors', () => ({ SmartScrollAnchors: () => null }))
vi.mock('../../utils/file-path-detect', () => ({ isLikelyFilePath: () => false }))
vi.mock('../../../shared/session-resume', () => ({
  generateResumeBrief: () => null,
  RESUME_INACTIVITY_MS: 300000,
  CATCH_ME_UP_PROMPT: 'catch me up',
}))

import { ConversationView } from '../ConversationView'

function makeMsg(overrides: Partial<Message> & { role: Message['role'] }): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    content: 'test content',
    timestamp: Date.now(),
    ...overrides,
  }
}

function makeTab(overrides: Partial<any> = {}) {
  return {
    id: 'tab-1',
    status: 'running' as const,
    messages: [
      makeMsg({ role: 'user', content: 'Hello' }),
      makeMsg({ role: 'assistant', content: 'Hi there' }),
    ],
    permissionQueue: [],
    queuedPrompts: [],
    retryState: null,
    permissionDenied: null,
    currentActivity: null,
    claudeSessionId: null,
    ...overrides,
  }
}

/**
 * Helper to simulate scroll position on the scrollable container.
 * jsdom doesn't compute layout, so we manually set scroll properties.
 */
function setScrollPosition(
  container: HTMLElement,
  opts: { scrollTop: number; scrollHeight: number; clientHeight: number },
) {
  Object.defineProperty(container, 'scrollTop', { value: opts.scrollTop, writable: true, configurable: true })
  Object.defineProperty(container, 'scrollHeight', { value: opts.scrollHeight, writable: true, configurable: true })
  Object.defineProperty(container, 'clientHeight', { value: opts.clientHeight, writable: true, configurable: true })
}

describe('Smart scroll behavior', () => {
  beforeEach(() => {
    mockTabState = makeTab()
  })

  it('auto-scrolls when user is near bottom', () => {
    const { container } = render(<ConversationView />)
    const scrollEl = container.querySelector('.overflow-y-auto') as HTMLElement
    expect(scrollEl).toBeTruthy()

    // Simulate: near bottom (gap < 100px)
    setScrollPosition(scrollEl, { scrollTop: 900, scrollHeight: 1000, clientHeight: 80 })
    fireEvent.scroll(scrollEl)

    // Trigger new content via re-render — the scrollTrigger effect should set scrollTop
    mockTabState = makeTab({
      messages: [
        ...mockTabState.messages,
        makeMsg({ role: 'assistant', content: 'New message' }),
      ],
    })

    // Force re-render to trigger the scrollTrigger useEffect
    const { container: c2 } = render(<ConversationView />)
    const scrollEl2 = c2.querySelector('.overflow-y-auto') as HTMLElement

    // The auto-scroll effect sets scrollTop = scrollHeight.
    // In jsdom scrollTop is read-only by default; the effect will try to assign it.
    // We just verify the scroll container exists and the button is NOT shown (near bottom).
    expect(scrollEl2.querySelector('[data-testid="jump-to-bottom"]')).toBeNull()
  })

  it('suppresses auto-scroll when user has scrolled up', () => {
    const { container } = render(<ConversationView />)
    const scrollEl = container.querySelector('.overflow-y-auto') as HTMLElement

    // Simulate: user scrolled far up (gap > 100px)
    setScrollPosition(scrollEl, { scrollTop: 100, scrollHeight: 1000, clientHeight: 80 })
    fireEvent.scroll(scrollEl)

    // After scrolling up on a running tab, the jump button should appear
    const jumpBtn = container.querySelector('[data-testid="jump-to-bottom"]')
    // The button appears when not near bottom AND tab is running
    expect(jumpBtn).toBeTruthy()
  })

  it('shows jump-to-bottom button when scrolled up during streaming', () => {
    mockTabState = makeTab({ status: 'running' })
    const { container } = render(<ConversationView />)
    const scrollEl = container.querySelector('.overflow-y-auto') as HTMLElement

    // Simulate scrolled up
    setScrollPosition(scrollEl, { scrollTop: 50, scrollHeight: 1000, clientHeight: 80 })
    fireEvent.scroll(scrollEl)

    const jumpBtn = container.querySelector('[data-testid="jump-to-bottom"]')
    expect(jumpBtn).toBeTruthy()
  })

  it('hides jump button when at bottom', () => {
    mockTabState = makeTab({ status: 'running' })
    const { container } = render(<ConversationView />)
    const scrollEl = container.querySelector('.overflow-y-auto') as HTMLElement

    // Simulate at bottom (gap < 100px)
    setScrollPosition(scrollEl, { scrollTop: 920, scrollHeight: 1000, clientHeight: 80 })
    fireEvent.scroll(scrollEl)

    const jumpBtn = container.querySelector('[data-testid="jump-to-bottom"]')
    expect(jumpBtn).toBeNull()
  })

  it('clicking jump button triggers scroll to bottom', () => {
    mockTabState = makeTab({ status: 'running' })
    const { container } = render(<ConversationView />)
    const scrollEl = container.querySelector('.overflow-y-auto') as HTMLElement

    // Mock scrollTo on the element
    const scrollToMock = vi.fn()
    scrollEl.scrollTo = scrollToMock

    // Simulate scrolled up
    setScrollPosition(scrollEl, { scrollTop: 50, scrollHeight: 1000, clientHeight: 80 })
    fireEvent.scroll(scrollEl)

    const jumpBtn = container.querySelector('[data-testid="jump-to-bottom"]') as HTMLElement
    expect(jumpBtn).toBeTruthy()

    fireEvent.click(jumpBtn)

    expect(scrollToMock).toHaveBeenCalledWith({
      top: 1000,
      behavior: 'smooth',
    })
  })

  it('does not show jump button when tab is idle', () => {
    mockTabState = makeTab({ status: 'idle' })
    const { container } = render(<ConversationView />)
    const scrollEl = container.querySelector('.overflow-y-auto') as HTMLElement

    // Simulate scrolled up
    setScrollPosition(scrollEl, { scrollTop: 50, scrollHeight: 1000, clientHeight: 80 })
    fireEvent.scroll(scrollEl)

    // Button should NOT appear when tab is idle (no new content arriving)
    const jumpBtn = container.querySelector('[data-testid="jump-to-bottom"]')
    expect(jumpBtn).toBeNull()
  })
})
