import { describe, it, expect } from 'vitest'
import {
  PromptAnalyzer,
  classifyIntent,
  detectContinuation,
  extractFilePathsFromText,
} from '../../../src/main/context/prompt-analyzer'

describe('prompt-analyzer', () => {
  describe('classifyIntent', () => {
    it('classifies fix intent', () => {
      expect(classifyIntent('Fix the broken authentication')).toBe('fix')
      expect(classifyIntent('There is a bug in the login flow')).toBe('fix')
      expect(classifyIntent('The server crashes on startup')).toBe('fix')
      expect(classifyIntent('This error happens every time')).toBe('fix')
    })

    it('classifies feature intent', () => {
      expect(classifyIntent('Add user registration endpoint')).toBe('feature')
      expect(classifyIntent('Create a new dashboard page')).toBe('feature')
      expect(classifyIntent('Implement password reset flow')).toBe('feature')
      expect(classifyIntent('Build a notification system')).toBe('feature')
    })

    it('classifies refactor intent', () => {
      expect(classifyIntent('Refactor the database layer')).toBe('refactor')
      expect(classifyIntent('Clean up the auth module')).toBe('refactor')
      expect(classifyIntent('Simplify the routing logic')).toBe('refactor')
      expect(classifyIntent('Extract common utilities')).toBe('refactor')
      expect(classifyIntent('Rename getUserData to fetchUser')).toBe('refactor')
    })

    it('classifies question intent', () => {
      expect(classifyIntent('What does this function do?')).toBe('question')
      expect(classifyIntent('Explain the authentication flow')).toBe('question')
      expect(classifyIntent('How does the cache work?')).toBe('question')
      expect(classifyIntent('Why is this code structured this way?')).toBe('question')
    })

    it('classifies review intent', () => {
      expect(classifyIntent('Review the PR changes')).toBe('review')
      expect(classifyIntent('Check the pull request')).toBe('review')
      expect(classifyIntent('Compare the diff')).toBe('review')
    })

    it('returns general for ambiguous prompts', () => {
      expect(classifyIntent('hello world')).toBe('general')
      expect(classifyIntent('src/index.ts')).toBe('general')
    })
  })

  describe('detectContinuation', () => {
    it('detects continuation signals', () => {
      expect(detectContinuation('Continue where we left off')).toBe(true)
      expect(detectContinuation('Pick up from last time')).toBe(true)
      expect(detectContinuation('Resume the previous work')).toBe(true)
      expect(detectContinuation('Finish the implementation we started earlier')).toBe(true)
      expect(detectContinuation('Back to the auth refactoring')).toBe(true)
    })

    it('returns false for non-continuation prompts', () => {
      expect(detectContinuation('Add a new feature')).toBe(false)
      expect(detectContinuation('Fix the login bug')).toBe(false)
      expect(detectContinuation('What does this code do?')).toBe(false)
    })
  })

  describe('extractFilePathsFromText', () => {
    it('extracts paths with extensions', () => {
      const files = extractFilePathsFromText('Look at src/auth/jwt.ts and fix it')
      expect(files).toContain('src/auth/jwt.ts')
    })

    it('extracts multiple paths', () => {
      const files = extractFilePathsFromText(
        'Edit src/auth/jwt.ts and test/auth.test.ts',
      )
      expect(files).toContain('src/auth/jwt.ts')
      expect(files).toContain('test/auth.test.ts')
    })

    it('extracts dot-prefixed paths', () => {
      const files = extractFilePathsFromText('Check ./config/settings.json')
      expect(files).toContain('./config/settings.json')
    })

    it('returns empty array for no paths', () => {
      expect(extractFilePathsFromText('Fix the authentication')).toEqual([])
    })

    it('deduplicates paths', () => {
      const files = extractFilePathsFromText(
        'Edit src/a.ts then check src/a.ts again',
      )
      expect(files.filter((f) => f === 'src/a.ts')).toHaveLength(1)
    })
  })

  describe('PromptAnalyzer', () => {
    it('returns complete signals object', () => {
      // Test without DB (null db) — should still work for basic analysis
      const analyzer = new PromptAnalyzer(null)
      const signals = analyzer.analyze('Fix the auth bug in src/auth/jwt.ts', 'proj-1')

      expect(signals.intent).toBe('fix')
      expect(signals.isContinuation).toBe(false)
      expect(signals.keyTerms.has('auth')).toBe(true)
      expect(signals.keyTerms.has('bug')).toBe(true)
      expect(signals.mentionedFiles).toContain('src/auth/jwt.ts')
    })

    it('detects continuation with expanded analysis', () => {
      const analyzer = new PromptAnalyzer(null)
      const signals = analyzer.analyze('Continue working on the auth module', 'proj-1')

      expect(signals.isContinuation).toBe(true)
      expect(signals.intent).toBe('general')
    })

    it('handles empty prompt gracefully', () => {
      const analyzer = new PromptAnalyzer(null)
      const signals = analyzer.analyze('', 'proj-1')

      expect(signals.intent).toBe('general')
      expect(signals.keyTerms.size).toBe(0)
      expect(signals.mentionedFiles).toEqual([])
      expect(signals.isContinuation).toBe(false)
    })
  })
})
