import { describe, it, expect } from 'vitest'
import { generateId } from '../../../src/main/context/id'

describe('generateId (UUID v7)', () => {
  it('returns a 36-character UUID string', () => {
    const id = generateId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()))
    expect(ids.size).toBe(1000)
  })

  it('is lexicographically sortable by creation time', async () => {
    const id1 = generateId()
    await new Promise(r => setTimeout(r, 2))
    const id2 = generateId()
    expect(id1 < id2).toBe(true)
  })

  it('has version 7 nibble', () => {
    const id = generateId()
    expect(id[14]).toBe('7')
  })

  it('has correct variant bits (10xx)', () => {
    const id = generateId()
    const variantChar = parseInt(id[19], 16)
    expect(variantChar >= 8 && variantChar <= 11).toBe(true)
  })
})
