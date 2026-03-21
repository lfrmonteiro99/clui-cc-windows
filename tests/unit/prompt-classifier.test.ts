import { describe, it, expect } from 'vitest'
import { classifyPrompt, type PromptClassification } from '../../src/shared/prompt-classifier'

describe('classifyPrompt', () => {
  // ─── Simple prompts → low score (Haiku territory: 0-30) ───

  it('scores a simple question as low complexity', () => {
    const result = classifyPrompt('what is a promise in javascript?')
    expect(result.score).toBeLessThanOrEqual(30)
    expect(result.suggestedModel).toBe('claude-haiku-4-5-20251001')
  })

  it('scores "explain" prompts as low complexity', () => {
    const result = classifyPrompt('explain how async/await works')
    expect(result.score).toBeLessThanOrEqual(30)
    expect(result.suggestedModel).toBe('claude-haiku-4-5-20251001')
  })

  it('scores simple listing prompts as low', () => {
    const result = classifyPrompt('list the HTTP status codes')
    expect(result.score).toBeLessThanOrEqual(30)
  })

  it('scores "how to" prompts as low', () => {
    const result = classifyPrompt('how to sort an array in python')
    expect(result.score).toBeLessThanOrEqual(30)
  })

  it('scores formatting requests as low', () => {
    const result = classifyPrompt('format this JSON for me')
    expect(result.score).toBeLessThanOrEqual(30)
  })

  // ─── Medium prompts → Sonnet territory (31-65) ───

  it('scores file-specific edits as medium complexity', () => {
    const result = classifyPrompt('fix the bug in src/utils/parser.ts where it fails on empty input')
    expect(result.score).toBeGreaterThan(30)
    expect(result.score).toBeLessThanOrEqual(65)
    expect(result.suggestedModel).toBe('claude-sonnet-4-6')
  })

  it('scores code review requests as medium', () => {
    const result = classifyPrompt('review this function and suggest improvements')
    expect(result.score).toBeGreaterThan(30)
    expect(result.score).toBeLessThanOrEqual(65)
  })

  it('scores test writing as medium', () => {
    const result = classifyPrompt('write unit tests for the UserService class')
    expect(result.score).toBeGreaterThan(30)
    expect(result.score).toBeLessThanOrEqual(65)
  })

  it('scores specific file fix requests as medium', () => {
    const result = classifyPrompt('update the login component to handle error states')
    expect(result.score).toBeGreaterThan(30)
    expect(result.score).toBeLessThanOrEqual(65)
  })

  // ─── Complex prompts → Opus territory (66-100) ───

  it('scores architecture tasks as high complexity', () => {
    const result = classifyPrompt('design a new authentication system with OAuth2, JWT tokens, and role-based access control across the entire project')
    expect(result.score).toBeGreaterThan(65)
    expect(result.suggestedModel).toBe('claude-opus-4-6')
  })

  it('scores multi-step refactoring as high', () => {
    const result = classifyPrompt('refactor the entire data layer to use a repository pattern, update all services and controllers, and add integration tests')
    expect(result.score).toBeGreaterThan(65)
  })

  it('scores deep debugging as high', () => {
    const result = classifyPrompt('debug the race condition in the distributed task queue that causes duplicate processing across multiple worker nodes')
    expect(result.score).toBeGreaterThan(65)
  })

  it('scores "across the codebase" prompts as high', () => {
    const result = classifyPrompt('analyze all files in the project and create a comprehensive dependency graph')
    expect(result.score).toBeGreaterThan(65)
  })

  // ─── Context signals ───

  it('increases score for prompts with many existing messages', () => {
    const short = classifyPrompt('continue', { messageCount: 2 })
    const long = classifyPrompt('continue', { messageCount: 30 })
    expect(long.score).toBeGreaterThan(short.score)
  })

  it('increases score for prompts with tool call history', () => {
    const noTools = classifyPrompt('fix the test', { toolCallCount: 0 })
    const manyTools = classifyPrompt('fix the test', { toolCallCount: 15 })
    expect(manyTools.score).toBeGreaterThan(noTools.score)
  })

  it('increases score for multiple attachments', () => {
    const noAttach = classifyPrompt('review this code', { attachmentCount: 0 })
    const multiAttach = classifyPrompt('review this code', { attachmentCount: 5 })
    expect(multiAttach.score).toBeGreaterThan(noAttach.score)
  })

  // ─── Return shape ───

  it('returns score, suggestedModel, and signals', () => {
    const result = classifyPrompt('hello')
    expect(result).toHaveProperty('score')
    expect(result).toHaveProperty('suggestedModel')
    expect(result).toHaveProperty('signals')
    expect(typeof result.score).toBe('number')
    expect(typeof result.suggestedModel).toBe('string')
    expect(typeof result.signals).toBe('object')
  })

  it('clamps score between 0 and 100', () => {
    const result = classifyPrompt('a')
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)

    const long = classifyPrompt('design architect implement refactor debug analyze all files across the entire codebase with comprehensive testing and documentation for every module and service in the distributed microservices architecture spanning multiple repositories')
    expect(long.score).toBeLessThanOrEqual(100)
  })

  // ─── Custom thresholds ───

  it('respects custom thresholds for model suggestion', () => {
    // A prompt that normally scores ~40 (Sonnet with default thresholds)
    const prompt = 'fix the bug in parser.ts'
    const defaultResult = classifyPrompt(prompt)

    // With thresholds set very high, should map to Haiku
    const customResult = classifyPrompt(prompt, {}, { haiku: 80, sonnet: 95 })
    expect(customResult.suggestedModel).toBe('claude-haiku-4-5-20251001')
  })

  // ─── Edge cases ───

  it('handles empty prompt', () => {
    const result = classifyPrompt('')
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.suggestedModel).toBeDefined()
  })

  it('handles very short prompt', () => {
    const result = classifyPrompt('hi')
    expect(result.score).toBeLessThanOrEqual(30)
    expect(result.suggestedModel).toBe('claude-haiku-4-5-20251001')
  })
})
