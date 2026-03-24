/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'

// Mock the heavy theme module to avoid DOM side effects at import time
vi.mock('../../theme', () => ({
  useColors: () => ({}),
}))

// Mock framer-motion to avoid React rendering issues
vi.mock('framer-motion', () => ({
  motion: { div: 'div' },
  AnimatePresence: ({ children }: { children: unknown }) => children,
}))

// Mock PopoverLayer
vi.mock('../PopoverLayer', () => ({
  usePopoverLayer: () => null,
}))

import { SLASH_COMMANDS, getFilteredCommands } from '../SlashCommandMenu'

describe('/effort slash command', () => {
  it('exists in SLASH_COMMANDS', () => {
    const effortCmd = SLASH_COMMANDS.find((c) => c.command === '/effort')
    expect(effortCmd).toBeDefined()
    expect(effortCmd!.description).toContain('effort')
  })

  it('appears when filtering for /effort', () => {
    const filtered = getFilteredCommands('/effort')
    expect(filtered.some((c) => c.command === '/effort')).toBe(true)
  })

  it('appears when filtering for /e', () => {
    const filtered = getFilteredCommands('/e')
    expect(filtered.some((c) => c.command === '/effort')).toBe(true)
  })
})
