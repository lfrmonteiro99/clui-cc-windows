/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, act } from '@testing-library/react'

// ─── Mocks ───

const mockColors: Record<string, string> = {
  accent: '#d97757',
  accentSoft: 'rgba(217, 119, 87, 0.15)',
  userBubble: '#353530',
  userBubbleBorder: '#4a4a45',
  userBubbleText: '#ccc9c0',
  containerBg: '#242422',
  containerBorder: '#3a3a35',
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
  cardShadow: '0 1px 3px rgba(0,0,0,0.1)',
}

vi.mock('../../theme', () => ({
  useColors: () => mockColors,
  useThemeStore: (selector: any) => {
    const state = { isDark: true, expandedUI: false }
    return selector ? selector(state) : state
  },
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ children, ...props }: any, ref: any) =>
      React.createElement('div', { ...props, ref }, children),
    ),
    button: React.forwardRef(({ children, ...props }: any, ref: any) =>
      React.createElement('button', { ...props, ref }, children),
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) =>
    React.createElement('div', { 'data-testid': 'markdown' }, children),
}))

vi.mock('remark-gfm', () => ({ default: {} }))

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

import type { Message, TabState } from '../../../shared/types'

// Mutable store state that tests can modify before render
let mockTabState: Partial<TabState> | null = null

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'Test',
    status: 'idle',
    messages: [],
    activeRequestId: null,
    hasUnread: false,
    currentActivity: '',
    permissionQueue: [],
    permissionDenied: null,
    retryState: null,
    claudeSessionId: null,
    lastResult: null,
    baseDirectory: null,
    attachments: [],
    lastRunOptions: null,
    queuedPrompts: [],
    queuedRunOptions: [],
    tokenUsage: null,
    contextNotificationShown: false,
    runtime: 'native',
    wslDistro: null,
    ...overrides,
  } as TabState
}

function makeMsg(overrides: Partial<Message> & { role: Message['role'] }): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    content: 'test content',
    timestamp: Date.now(),
    ...overrides,
  }
}

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: Object.assign(
    (selector: any) => {
      const state = {
        activeTabId: 'tab-1',
        tabs: mockTabState ? [makeTab(mockTabState as any)] : [],
        sendMessage: vi.fn(),
        staticInfo: null,
      }
      return selector ? selector(state) : state
    },
    { getState: () => ({ activeTabId: 'tab-1' }), setState: vi.fn() },
  ),
}))

import { AssistantMessage } from '../ConversationView'
// Lazy import ConversationView since it needs full tab state
const { ConversationView } = await import('../ConversationView')

describe('Streaming cursor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockTabState = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('AssistantMessage cursor class', () => {
    it('adds streaming-cursor class when isStreaming is true', () => {
      const msg = makeMsg({ role: 'assistant', content: 'Hello' })
      render(<AssistantMessage message={msg} skipMotion isStreaming />)
      const el = screen.getByTestId('message-assistant')
      const proseDiv = el.querySelector('.prose-cloud')
      expect(proseDiv?.classList.contains('streaming-cursor')).toBe(true)
    })

    it('does not add streaming-cursor class when isStreaming is false', () => {
      const msg = makeMsg({ role: 'assistant', content: 'Hello' })
      render(<AssistantMessage message={msg} skipMotion />)
      const el = screen.getByTestId('message-assistant')
      const proseDiv = el.querySelector('.prose-cloud')
      expect(proseDiv?.classList.contains('streaming-cursor')).toBe(false)
    })

    it('does not add streaming-cursor class when isStreaming is undefined', () => {
      const msg = makeMsg({ role: 'assistant', content: 'Done' })
      render(<AssistantMessage message={msg} skipMotion />)
      const el = screen.getByTestId('message-assistant')
      const proseDiv = el.querySelector('.prose-cloud')
      expect(proseDiv?.classList.contains('streaming-cursor')).toBe(false)
    })
  })

  describe('Elapsed time in activity row', () => {
    it('shows elapsed time during running status', () => {
      mockTabState = {
        status: 'running',
        currentActivity: 'Thinking...',
        messages: [makeMsg({ role: 'user', content: 'hi' })],
      }
      render(<ConversationView />)

      // Advance timer to show elapsed
      act(() => { vi.advanceTimersByTime(3000) })

      const activityRow = screen.getByTestId('conversation-view')
      // Should contain elapsed time like "3.0s"
      expect(activityRow.textContent).toMatch(/\d+\.\ds/)
    })

    it('does not show elapsed time when idle', () => {
      mockTabState = {
        status: 'idle',
        currentActivity: '',
        messages: [makeMsg({ role: 'user', content: 'hi' })],
      }
      render(<ConversationView />)
      const activityRow = screen.getByTestId('conversation-view')
      expect(activityRow.textContent).not.toMatch(/\d+\.\ds/)
    })

    it('resets elapsed time when status transitions from running to completed', () => {
      mockTabState = {
        status: 'running',
        currentActivity: 'Working...',
        messages: [makeMsg({ role: 'user', content: 'hi' })],
      }
      const { rerender } = render(<ConversationView />)

      act(() => { vi.advanceTimersByTime(5000) })

      // Transition to completed
      mockTabState = {
        status: 'completed',
        currentActivity: '',
        messages: [
          makeMsg({ role: 'user', content: 'hi' }),
          makeMsg({ role: 'assistant', content: 'done' }),
        ],
      }
      rerender(<ConversationView />)

      const activityRow = screen.getByTestId('conversation-view')
      expect(activityRow.textContent).not.toMatch(/\d+\.\ds/)
    })
  })

  describe('ConversationView passes isStreaming to last assistant message', () => {
    it('last assistant message gets streaming cursor when running', () => {
      mockTabState = {
        status: 'running',
        currentActivity: 'Writing...',
        messages: [
          makeMsg({ role: 'user', content: 'hi' }),
          makeMsg({ role: 'assistant', content: 'Hello there' }),
        ],
      }
      render(<ConversationView />)
      const assistantMsgs = screen.getAllByTestId('message-assistant')
      const lastAssistant = assistantMsgs[assistantMsgs.length - 1]
      const proseDiv = lastAssistant.querySelector('.prose-cloud')
      expect(proseDiv?.classList.contains('streaming-cursor')).toBe(true)
    })

    it('no streaming cursor on assistant message when idle', () => {
      mockTabState = {
        status: 'idle',
        currentActivity: '',
        messages: [
          makeMsg({ role: 'user', content: 'hi' }),
          makeMsg({ role: 'assistant', content: 'Hello there' }),
        ],
      }
      render(<ConversationView />)
      const assistantMsgs = screen.getAllByTestId('message-assistant')
      const lastAssistant = assistantMsgs[assistantMsgs.length - 1]
      const proseDiv = lastAssistant.querySelector('.prose-cloud')
      expect(proseDiv?.classList.contains('streaming-cursor')).toBe(false)
    })
  })
})
