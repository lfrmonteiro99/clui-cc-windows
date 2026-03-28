import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SMART_PACKET_CONFIG,
  ContextTier,
} from '../../src/main/context/types'
import { trimSystemPromptIfNeeded, MAX_APPENDED_SYSTEM_TOKENS } from '../../src/main/claude/run-manager'

describe('CTX-002: Smart packet token budget', () => {
  describe('DEFAULT_SMART_PACKET_CONFIG', () => {
    it('should have totalBudget of 5000', () => {
      expect(DEFAULT_SMART_PACKET_CONFIG.totalBudget).toBe(5000)
    })

    it('should have updated tier budgets', () => {
      const { tierBudgets } = DEFAULT_SMART_PACKET_CONFIG
      expect(tierBudgets[ContextTier.ProjectState]).toBe(200)
      expect(tierBudgets[ContextTier.Continuation]).toBe(400)
      expect(tierBudgets[ContextTier.Decisions]).toBe(800)
      expect(tierBudgets[ContextTier.Pitfalls]).toBe(600)
      expect(tierBudgets[ContextTier.HotFiles]).toBe(300)
      expect(tierBudgets[ContextTier.Patterns]).toBe(400)
      expect(tierBudgets[ContextTier.RelevantMemories]).toBe(700)
      expect(tierBudgets[ContextTier.RecentSessions]).toBe(650)
    })

    it('should have tier budgets that sum to no more than totalBudget + 50 (slack)', () => {
      const { tierBudgets, totalBudget } = DEFAULT_SMART_PACKET_CONFIG
      const sum = Object.values(tierBudgets).reduce(
        (acc, val) => acc + (val ?? 0),
        0,
      )
      // Tier budgets may slightly exceed totalBudget since the assembler trims;
      // but they should be in the same ballpark.
      expect(sum).toBeLessThanOrEqual(totalBudget + 50)
      // And they should be reasonably close to the total
      expect(sum).toBeGreaterThan(totalBudget * 0.7)
    })
  })

  describe('System prompt safety cap', () => {
    it('should export MAX_APPENDED_SYSTEM_TOKENS as 8000', () => {
      expect(MAX_APPENDED_SYSTEM_TOKENS).toBe(8000)
    })

    it('should not trim a prompt under the safety cap', () => {
      const cluiHint = 'You are inside CLUI.'
      // 100 tokens * 4 chars/token = 400 chars
      const smartPacket = 'x'.repeat(400)
      const result = trimSystemPromptIfNeeded(smartPacket, cluiHint)
      expect(result).toBe(smartPacket + '\n\n' + cluiHint)
    })

    it('should trim the smart packet when combined prompt exceeds safety cap', () => {
      const cluiHint = 'You are inside CLUI.'
      // Create a smart packet that, combined with the hint, exceeds 8000 tokens (32000 chars)
      const smartPacket = 'x'.repeat(33000)
      const result = trimSystemPromptIfNeeded(smartPacket, cluiHint)
      // The result should be trimmed so total tokens <= 8000
      const estimatedTokens = Math.ceil(result.length / 4)
      expect(estimatedTokens).toBeLessThanOrEqual(MAX_APPENDED_SYSTEM_TOKENS)
      // The CLUI hint should still be present
      expect(result).toContain(cluiHint)
    })

    it('should preserve the CLUI hint even when trimming aggressively', () => {
      const cluiHint = 'You are inside CLUI. Use rich formatting.'
      const smartPacket = 'y'.repeat(40000)
      const result = trimSystemPromptIfNeeded(smartPacket, cluiHint)
      expect(result).toContain(cluiHint)
    })
  })

  describe('Smart packet respects new budget', () => {
    it('should allow content up to 5000 tokens in the smart packet config', () => {
      // A packet of ~4000 tokens (16000 chars) should fit within 5000 budget
      expect(DEFAULT_SMART_PACKET_CONFIG.totalBudget).toBeGreaterThanOrEqual(5000)
    })

    it('should have higher tier budgets than before (regression check)', () => {
      // Old values were: ProjectState=100, Continuation=200, Decisions=400, etc.
      // New values should all be >= the old ones
      const { tierBudgets } = DEFAULT_SMART_PACKET_CONFIG
      expect(tierBudgets[ContextTier.ProjectState]!).toBeGreaterThanOrEqual(200)
      expect(tierBudgets[ContextTier.Continuation]!).toBeGreaterThanOrEqual(400)
      expect(tierBudgets[ContextTier.Decisions]!).toBeGreaterThanOrEqual(800)
      expect(tierBudgets[ContextTier.Pitfalls]!).toBeGreaterThanOrEqual(600)
      expect(tierBudgets[ContextTier.HotFiles]!).toBeGreaterThanOrEqual(300)
      expect(tierBudgets[ContextTier.Patterns]!).toBeGreaterThanOrEqual(400)
      expect(tierBudgets[ContextTier.RelevantMemories]!).toBeGreaterThanOrEqual(700)
      expect(tierBudgets[ContextTier.RecentSessions]!).toBeGreaterThanOrEqual(650)
    })
  })
})
