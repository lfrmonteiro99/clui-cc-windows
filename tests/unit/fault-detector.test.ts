import { describe, it, expect } from 'vitest'
import { detectCorrection } from '../../src/shared/fault-detector'

describe('fault-detector', () => {
  describe('detectCorrection', () => {
    it('detects "use X instead of Y" pattern', () => {
      const result = detectCorrection('Use pnpm instead of npm')
      expect(result).not.toBeNull()
      expect(result!.correction).toContain('pnpm')
      expect(result!.pattern).toContain('npm')
    })

    it('detects "use X not Y" pattern', () => {
      const result = detectCorrection('Use vitest not jest')
      expect(result).not.toBeNull()
      expect(result!.correction).toContain('vitest')
      expect(result!.pattern).toContain('jest')
    })

    it('detects "don\'t use Y, use X" pattern', () => {
      const result = detectCorrection("don't use npm, use pnpm")
      expect(result).not.toBeNull()
    })

    it('detects "we use X" pattern', () => {
      const result = detectCorrection('We use TypeScript in this project')
      expect(result).not.toBeNull()
      expect(result!.correction).toContain('TypeScript')
    })

    it('detects "prefer X over Y" pattern', () => {
      const result = detectCorrection('Prefer async/await over .then()')
      expect(result).not.toBeNull()
    })

    it('returns null for normal messages', () => {
      expect(detectCorrection('Can you help me with this function?')).toBeNull()
      expect(detectCorrection('Thanks, that looks good!')).toBeNull()
      expect(detectCorrection('Please refactor the auth module')).toBeNull()
    })

    it('returns null for empty input', () => {
      expect(detectCorrection('')).toBeNull()
      expect(detectCorrection('  ')).toBeNull()
    })

    it('assigns category for known tool patterns', () => {
      const result = detectCorrection('Use pnpm instead of npm')
      expect(result).not.toBeNull()
      expect(result!.category).toBe('tooling')
    })

    it('detects "always use X" pattern', () => {
      const result = detectCorrection('Always use relative imports')
      expect(result).not.toBeNull()
      expect(result!.correction).toContain('relative imports')
    })
  })
})
