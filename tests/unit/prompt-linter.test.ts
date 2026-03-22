import { describe, expect, it } from 'vitest'
import { lintPrompt } from '../../src/shared/prompt-linter'

describe('lintPrompt', () => {
  it('returns empty array for empty input', () => {
    expect(lintPrompt('')).toEqual([])
    expect(lintPrompt('   ')).toEqual([])
  })

  it('returns empty array for slash commands', () => {
    expect(lintPrompt('/clear')).toEqual([])
    expect(lintPrompt('/model sonnet')).toEqual([])
  })

  // ─── ambiguous-scope ───

  describe('ambiguous-scope', () => {
    it('warns on short "fix this" without file reference', () => {
      const warnings = lintPrompt('fix this')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'ambiguous-scope' }))
    })

    it('warns on "change this please"', () => {
      const warnings = lintPrompt('change this please')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'ambiguous-scope' }))
    })

    it('warns on "update this"', () => {
      const warnings = lintPrompt('update this')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'ambiguous-scope' }))
    })

    it('does not warn when a file extension is present', () => {
      const warnings = lintPrompt('fix this in App.tsx')
      expect(warnings).not.toContainEqual(expect.objectContaining({ id: 'ambiguous-scope' }))
    })

    it('does not warn for long prompts even with "fix this"', () => {
      const long = 'fix this issue where the sidebar component does not render correctly when the user resizes the window'
      expect(long.length).toBeGreaterThanOrEqual(80)
      const warnings = lintPrompt(long)
      expect(warnings).not.toContainEqual(expect.objectContaining({ id: 'ambiguous-scope' }))
    })
  })

  // ─── multi-task ───

  describe('multi-task', () => {
    it('warns on "and also" connector', () => {
      const warnings = lintPrompt('fix the bug and also update the readme')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'multi-task' }))
    })

    it('warns on "and then" connector', () => {
      const warnings = lintPrompt('create the component and then write tests for it')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'multi-task' }))
    })

    it('warns on "plus " connector', () => {
      const warnings = lintPrompt('refactor the module plus add error handling')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'multi-task' }))
    })

    it('warns when 3+ imperative verbs are present', () => {
      const warnings = lintPrompt('fix the bug, add a test, and update the documentation')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'multi-task' }))
    })

    it('does not warn for a single task', () => {
      const warnings = lintPrompt('fix the authentication bug in login.ts')
      expect(warnings).not.toContainEqual(expect.objectContaining({ id: 'multi-task' }))
    })

    it('does not warn for two imperative verbs (below threshold)', () => {
      const warnings = lintPrompt('fix the bug and improve the error message')
      // "fix" and "improve" — improve is not in the verb list, so only 1 match
      expect(warnings).not.toContainEqual(expect.objectContaining({ id: 'multi-task' }))
    })
  })

  // ─── vague-pronouns ───

  describe('vague-pronouns', () => {
    it('warns on "fix it"', () => {
      const warnings = lintPrompt('fix it')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'vague-pronouns' }))
    })

    it('warns on "do it"', () => {
      const warnings = lintPrompt('do it')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'vague-pronouns' }))
    })

    it('warns on "make it work"', () => {
      const warnings = lintPrompt('make it work')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'vague-pronouns' }))
    })

    it('warns on "change it"', () => {
      const warnings = lintPrompt('change it')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'vague-pronouns' }))
    })

    it('does not warn for long prompts with "fix it"', () => {
      const long = 'fix it by updating the authentication middleware to properly validate JWT tokens on each request'
      expect(long.length).toBeGreaterThanOrEqual(80)
      const warnings = lintPrompt(long)
      expect(warnings).not.toContainEqual(expect.objectContaining({ id: 'vague-pronouns' }))
    })

    it('does not warn when "fix it" is not at the start', () => {
      const warnings = lintPrompt('please go ahead and fix it')
      expect(warnings).not.toContainEqual(expect.objectContaining({ id: 'vague-pronouns' }))
    })
  })

  // ─── broad-scope ───

  describe('broad-scope', () => {
    it('warns on "all files"', () => {
      const warnings = lintPrompt('update all files to use the new API')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'broad-scope' }))
    })

    it('warns on "entire project"', () => {
      const warnings = lintPrompt('refactor the entire project')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'broad-scope' }))
    })

    it('warns on "everything"', () => {
      const warnings = lintPrompt('check everything for bugs')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'broad-scope' }))
    })

    it('warns on "whole codebase"', () => {
      const warnings = lintPrompt('search the whole codebase for security issues')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'broad-scope' }))
    })

    it('warns on "every file"', () => {
      const warnings = lintPrompt('lint every file')
      expect(warnings).toContainEqual(expect.objectContaining({ id: 'broad-scope' }))
    })

    it('does not warn for scoped prompts', () => {
      const warnings = lintPrompt('update the auth module to use the new token format')
      expect(warnings).not.toContainEqual(expect.objectContaining({ id: 'broad-scope' }))
    })
  })

  // ─── Multiple warnings ───

  it('can return multiple warnings for a single prompt', () => {
    const warnings = lintPrompt('fix this and also update everything')
    const ids = warnings.map((w) => w.id)
    expect(ids).toContain('ambiguous-scope')
    expect(ids).toContain('multi-task')
    expect(ids).toContain('broad-scope')
  })

  it('returns no warnings for a well-formed prompt', () => {
    const warnings = lintPrompt('Add error handling to the parseConfig function in src/config.ts')
    expect(warnings).toEqual([])
  })
})
