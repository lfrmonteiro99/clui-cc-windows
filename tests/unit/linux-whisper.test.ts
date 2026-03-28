import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mockPlatform } from '../helpers/mock-platform'

/**
 * Tests for #263 LINUX-008: Whisper provisioner Linux guard
 * and whisper-paths Linux support.
 */

// Top-level mocks for whisper-provisioner tests
vi.mock('electron', () => ({ net: { request: vi.fn() } }))
vi.mock('../../src/main/logger', () => ({ log: vi.fn() }))

// We need to control existsSync per-test for provisioner tests
const mockExistsSync = vi.fn(() => false)
const mockMkdirSync = vi.fn()
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
    accessSync: vi.fn(),
    createWriteStream: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  }
})

describe('Whisper Linux support (#263)', () => {
  let restorePlatform: (() => void) | null = null

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
  })

  afterEach(() => {
    restorePlatform?.()
    restorePlatform = null
  })

  describe('whisper-paths — Linux paths', () => {
    it('includes Linux-specific binary paths on Linux', async () => {
      restorePlatform = mockPlatform('linux')

      const { getWhisperBinaryCandidates } = await import('../../src/main/whisper-paths')
      const candidates = getWhisperBinaryCandidates()

      // Should include standard Linux paths
      expect(candidates.some(c => c.includes('/usr/bin/whisper'))).toBe(true)
      expect(candidates.some(c => c.includes('.local/bin/whisper'))).toBe(true)
    })

    it('does NOT include Homebrew paths on Linux', async () => {
      restorePlatform = mockPlatform('linux')

      const { getWhisperBinaryCandidates } = await import('../../src/main/whisper-paths')
      const candidates = getWhisperBinaryCandidates()

      expect(candidates.some(c => c.includes('/opt/homebrew/'))).toBe(false)
    })

    it('includes Homebrew paths on macOS', async () => {
      restorePlatform = mockPlatform('darwin')

      const { getWhisperBinaryCandidates } = await import('../../src/main/whisper-paths')
      const candidates = getWhisperBinaryCandidates()

      expect(candidates.some(c => c.includes('/opt/homebrew/'))).toBe(true)
    })

    it('Linux model candidates do NOT include Homebrew dirs', async () => {
      restorePlatform = mockPlatform('linux')

      const { getWhisperModelCandidates } = await import('../../src/main/whisper-paths')
      const candidates = getWhisperModelCandidates()

      expect(candidates.some(c => c.includes('/opt/homebrew/'))).toBe(false)
    })

    it('returns Linux-specific not-found message on Linux', async () => {
      restorePlatform = mockPlatform('linux')

      const { getWhisperNotFoundMessage } = await import('../../src/main/whisper-paths')
      const msg = getWhisperNotFoundMessage()

      expect(msg).toContain('package manager')
      expect(msg).not.toContain('brew')
    })

    it('returns Linux-specific model download message on Linux', async () => {
      restorePlatform = mockPlatform('linux')

      const { getModelDownloadMessage } = await import('../../src/main/whisper-paths')
      const msg = getModelDownloadMessage()

      expect(msg).toContain('mkdir -p')
      expect(msg).toContain('curl')
    })
  })

  describe('whisper-provisioner — Linux guard', () => {
    it('returns skipped on Linux when no binary exists', async () => {
      restorePlatform = mockPlatform('linux')
      mockExistsSync.mockReturnValue(false)

      const { ensureWhisper } = await import('../../src/main/whisper-provisioner')
      const statuses: Array<{ stage: string }> = []

      await ensureWhisper((status) => statuses.push(status))

      expect(statuses.some(s => s.stage === 'skipped')).toBe(true)
      // Should NOT attempt download on Linux
      expect(statuses.some(s => s.stage === 'downloading-binary')).toBe(false)
    })

    it('returns ready on Linux when binary exists', async () => {
      restorePlatform = mockPlatform('linux')
      mockExistsSync.mockReturnValue(true)

      const { ensureWhisper } = await import('../../src/main/whisper-provisioner')
      const statuses: Array<{ stage: string }> = []

      await ensureWhisper((status) => statuses.push(status))

      expect(statuses.some(s => s.stage === 'ready')).toBe(true)
    })
  })
})
