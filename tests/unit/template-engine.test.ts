import { describe, it, expect } from 'vitest'
import { parseTemplate, resolveVariables, findNextSlot, findPreviousSlot, hasSlots, hasVariables } from '../../src/shared/template-engine'

describe('template-engine', () => {
  describe('parseTemplate', () => {
    it('parses slots from template', () => {
      const result = parseTemplate('Fix [FILE] — [DESCRIPTION]')
      expect(result.slots).toHaveLength(2)
      expect(result.slots[0].name).toBe('FILE')
      expect(result.slots[1].name).toBe('DESCRIPTION')
    })

    it('parses variables from template', () => {
      const result = parseTemplate('On branch {{git.branch}}, fix {{clipboard}}')
      expect(result.variables).toContain('git.branch')
      expect(result.variables).toContain('clipboard')
    })

    it('handles templates with no slots or variables', () => {
      const result = parseTemplate('Just a plain prompt')
      expect(result.slots).toHaveLength(0)
      expect(result.variables).toHaveLength(0)
    })

    it('handles empty template', () => {
      const result = parseTemplate('')
      expect(result.slots).toHaveLength(0)
      expect(result.variables).toHaveLength(0)
    })

    it('captures slot position and length', () => {
      const result = parseTemplate('[FILE]')
      expect(result.slots[0].index).toBe(0)
      expect(result.slots[0].length).toBe(6)
    })
  })

  describe('resolveVariables', () => {
    it('replaces known variables', () => {
      const result = resolveVariables('Branch: {{git.branch}}', { 'git.branch': 'main' })
      expect(result).toBe('Branch: main')
    })

    it('leaves unknown variables as-is', () => {
      const result = resolveVariables('Branch: {{git.branch}}', {})
      expect(result).toBe('Branch: {{git.branch}}')
    })

    it('replaces multiple variables', () => {
      const result = resolveVariables('{{a}} and {{b}}', { a: 'X', b: 'Y' })
      expect(result).toBe('X and Y')
    })
  })

  describe('findNextSlot', () => {
    it('finds the next slot after cursor position', () => {
      const slot = findNextSlot('Fix [FILE] — [DESC]', 0)
      expect(slot).not.toBeNull()
      expect(slot!.name).toBe('FILE')
    })

    it('finds the second slot when cursor is past the first', () => {
      const slot = findNextSlot('Fix [FILE] — [DESC]', 11)
      expect(slot).not.toBeNull()
      expect(slot!.name).toBe('DESC')
    })

    it('wraps around when cursor is past all slots', () => {
      const slot = findNextSlot('Fix [FILE] — [DESC]', 100)
      expect(slot).not.toBeNull()
      expect(slot!.name).toBe('FILE')
    })

    it('returns null for text with no slots', () => {
      const slot = findNextSlot('No slots here', 0)
      expect(slot).toBeNull()
    })
  })

  describe('findPreviousSlot', () => {
    it('finds previous slot before cursor', () => {
      // [A] is at index 0, [B] is at index 8. Cursor at 5 is after [A] but before [B].
      const slot = findPreviousSlot('[A] and [B]', 5)
      expect(slot).not.toBeNull()
      expect(slot!.name).toBe('A')
    })

    it('wraps to last slot when cursor is before all slots', () => {
      const slot = findPreviousSlot('[A] and [B]', 0)
      expect(slot).not.toBeNull()
      expect(slot!.name).toBe('B')
    })
  })

  describe('hasSlots', () => {
    it('returns true for templates with slots', () => {
      expect(hasSlots('[FILE]')).toBe(true)
    })

    it('returns false for templates without slots', () => {
      expect(hasSlots('no slots')).toBe(false)
    })
  })

  describe('hasVariables', () => {
    it('returns true for templates with variables', () => {
      expect(hasVariables('{{git.branch}}')).toBe(true)
    })

    it('returns false for templates without variables', () => {
      expect(hasVariables('no vars')).toBe(false)
    })
  })
})
