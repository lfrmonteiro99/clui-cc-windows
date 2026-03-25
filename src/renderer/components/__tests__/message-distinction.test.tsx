/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

// Mock theme module — return real-ish token values so style assertions work
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

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: Object.assign(
    (selector: any) => {
      const state = {
        activeTabId: 'tab-1',
        tabs: [],
        sendMessage: vi.fn(),
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
vi.mock('../../utils/file-path-detect', () => ({ isLikelyFilePath: () => false }))
vi.mock('../../../shared/session-resume', () => ({
  generateResumeBrief: () => null,
  RESUME_INACTIVITY_MS: 300000,
  CATCH_ME_UP_PROMPT: 'catch me up',
}))

import {
  UserMessage,
  AssistantMessage,
  SystemMessage,
  MESSAGE_GAP_CLASS,
} from '../ConversationView'

import type { Message } from '../../../shared/types'

function makeMsg(overrides: Partial<Message> & { role: Message['role'] }): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    content: 'test content',
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('Message visual distinction', () => {
  describe('AssistantMessage', () => {
    it('has a 3px left accent border', () => {
      const msg = makeMsg({ role: 'assistant', content: 'Hello world' })
      render(<AssistantMessage message={msg} skipMotion />)
      const el = screen.getByTestId('message-assistant')
      // jsdom normalizes hex to rgb(), so check for 3px solid + rgb values of #d97757
      expect(el.style.borderLeft).toContain('3px solid')
      expect(el.style.borderLeft).toContain('rgb(217, 119, 87)')
    })

    it('has assistant background color token', () => {
      const msg = makeMsg({ role: 'assistant', content: 'Test reply' })
      render(<AssistantMessage message={msg} skipMotion />)
      const el = screen.getByTestId('message-assistant')
      expect(el.style.background).toBe(mockColors.messageBgAssistant)
    })
  })

  describe('UserMessage', () => {
    it('has user bubble background distinct from assistant', () => {
      const msg = makeMsg({ role: 'user', content: 'Hi there' })
      render(<UserMessage message={msg} skipMotion />)
      const el = screen.getByTestId('message-user')
      // jsdom normalizes #353530 to rgb(53, 53, 48)
      expect(el.style.background).toBe('rgb(53, 53, 48)')
      // Token values must differ between user and assistant
      expect(mockColors.userBubble).not.toBe(mockColors.messageBgAssistant)
    })
  })

  describe('SystemMessage', () => {
    it('uses muted smaller italic text with centered layout', () => {
      const msg = makeMsg({ role: 'system', content: 'System notice' })
      render(<SystemMessage message={msg} skipMotion />)
      const el = screen.getByTestId('message-system')
      expect(el.style.fontStyle).toBe('italic')
      expect(el.className).toContain('text-xs')
      const wrapper = el.parentElement!
      expect(wrapper.className).toContain('text-center')
    })
  })

  describe('Message gap', () => {
    it('MESSAGE_GAP_CLASS provides at least 20px spacing (space-y-5 or larger)', () => {
      const match = MESSAGE_GAP_CLASS.match(/space-y-(\d+)/)
      expect(match).not.toBeNull()
      const gapLevel = parseInt(match![1], 10)
      expect(gapLevel).toBeGreaterThanOrEqual(5)
    })
  })
})
