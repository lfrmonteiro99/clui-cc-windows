/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render } from '@testing-library/react'

// Mock theme — must include codeBlockBg and codeBlockText tokens
const mockColors: Record<string, string> = {
  accent: '#d97757',
  accentSoft: 'rgba(217, 119, 87, 0.15)',
  userBubble: '#353530',
  userBubbleBorder: '#4a4a45',
  userBubbleText: '#ccc9c0',
  containerBg: '#242422',
  containerBorder: '#3b3b36',
  textPrimary: '#ccc9c0',
  textSecondary: '#c0bdb2',
  textTertiary: '#76766e',
  textMuted: '#353530',
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
  codeBg: '#1a1a18',
  codeBlockBg: '#1a1a18',
  codeBlockText: '#b8b5aa',
  accentLight: 'rgba(217, 119, 87, 0.1)',
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
        tabs: [{
          id: 'tab-1',
          status: 'idle',
          messages: [],
          permissionQueue: [],
          queuedPrompts: [],
          additionalDirs: [],
          hasChosenDirectory: false,
          workingDirectory: '~',
          claudeSessionId: null,
          agentAssignment: null,
        }],
        sendMessage: vi.fn(),
        staticInfo: null,
      }
      return typeof selector === 'function' ? selector(state) : state
    },
    {
      getState: () => ({ activeTabId: 'tab-1', tabs: [] }),
      setState: vi.fn(),
      subscribe: vi.fn(),
    },
  ),
}))

vi.mock('../../utils/shiki', () => ({
  highlightCode: vi.fn().mockResolvedValue(null),
}))

vi.mock('../FilePath', () => ({
  FilePath: ({ path }: any) => React.createElement('span', {}, path),
}))

vi.mock('../../utils/file-path-detect', () => ({
  isLikelyFilePath: () => false,
}))

// Static imports — mocks are hoisted so these resolve against mocked modules
import { CodeBlock } from '../CodeBlock'
import { UserMessage, AssistantMessage, SystemMessage } from '../ConversationView'

// ─── Tests ───

describe('Typography hierarchy and contrast', () => {
  describe('Theme tokens', () => {
    it('darkColors has codeBlockBg token (opaque)', async () => {
      const theme = await vi.importActual<typeof import('../../theme')>('../../theme')
      const dark = theme.getColors(true)
      expect(dark).toHaveProperty('codeBlockBg')
      expect(dark.codeBlockBg).not.toMatch(/rgba/)
      expect(dark.codeBlockBg).not.toMatch(/\/\d/)
    })

    it('lightColors has codeBlockBg token (opaque)', async () => {
      const theme = await vi.importActual<typeof import('../../theme')>('../../theme')
      const light = theme.getColors(false)
      expect(light).toHaveProperty('codeBlockBg')
      expect(light.codeBlockBg).not.toMatch(/rgba/)
      expect(light.codeBlockBg).not.toMatch(/\/\d/)
    })

    it('darkColors has codeBlockText token', async () => {
      const theme = await vi.importActual<typeof import('../../theme')>('../../theme')
      const dark = theme.getColors(true)
      expect(dark).toHaveProperty('codeBlockText')
    })

    it('lightColors has codeBlockText token', async () => {
      const theme = await vi.importActual<typeof import('../../theme')>('../../theme')
      const light = theme.getColors(false)
      expect(light).toHaveProperty('codeBlockText')
    })

    it('codeBg tokens are opaque hex values', async () => {
      const theme = await vi.importActual<typeof import('../../theme')>('../../theme')
      const dark = theme.getColors(true)
      const light = theme.getColors(false)
      expect(dark.codeBg).toMatch(/^#[0-9a-f]{6}$/i)
      expect(light.codeBg).toMatch(/^#[0-9a-f]{6}$/i)
    })
  })

  describe('CodeBlock component', () => {
    it('renders with font-mono class', () => {
      const { container } = render(<CodeBlock code="const x = 1" language="ts" />)
      const codeArea = container.querySelector('[class*="font-mono"]')
      expect(codeArea).not.toBeNull()
    })

    it('code content uses 12px font size', () => {
      const { container } = render(<CodeBlock code="const x = 1" language="ts" />)
      const codeArea = container.querySelector('[class*="text-[12px]"]')
      expect(codeArea).not.toBeNull()
    })
  })

  describe('Message typography', () => {
    it('user message uses text-[13px] leading-[1.6]', () => {
      const msg = { id: 'u1', role: 'user' as const, content: 'Hello', timestamp: Date.now() }
      const { container } = render(<UserMessage message={msg} />)
      const bubble = container.querySelector('[data-testid="message-user"]')
      expect(bubble).not.toBeNull()
      expect(bubble!.className).toContain('text-[13px]')
      expect(bubble!.className).toContain('leading-[1.6]')
    })

    it('assistant message body uses text-[13px] leading-[1.6]', () => {
      const msg = { id: 'a1', role: 'assistant' as const, content: 'Hi there', timestamp: Date.now() }
      const { container } = render(<AssistantMessage message={msg} />)
      const prose = container.querySelector('.prose-cloud')
      expect(prose).not.toBeNull()
      expect(prose!.className).toContain('text-[13px]')
      expect(prose!.className).toContain('leading-[1.6]')
    })

    it('system message uses text-xs (12px)', () => {
      const msg = { id: 's1', role: 'system' as const, content: 'System info', timestamp: Date.now() }
      const { container } = render(<SystemMessage message={msg} />)
      const el = container.querySelector('[data-testid="message-system"]')
      expect(el).not.toBeNull()
      expect(el!.className).toContain('text-xs')
    })
  })
})
