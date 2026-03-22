import { describe, it, expect } from 'vitest'
import { CircularBuffer } from '../../src/main/circular-buffer'

describe('CircularBuffer', () => {
  it('stores items up to capacity', () => {
    const buf = new CircularBuffer<string>(3)
    buf.push('a')
    buf.push('b')
    buf.push('c')
    expect(buf.toArray()).toEqual(['a', 'b', 'c'])
    expect(buf.size).toBe(3)
  })

  it('overwrites oldest item when capacity is exceeded', () => {
    const buf = new CircularBuffer<string>(3)
    buf.push('a')
    buf.push('b')
    buf.push('c')
    buf.push('d')
    // 'a' should be dropped
    expect(buf.toArray()).toEqual(['b', 'c', 'd'])
    expect(buf.size).toBe(3)
  })

  it('maintains insertion order in toArray', () => {
    const buf = new CircularBuffer<number>(5)
    for (let i = 0; i < 8; i++) buf.push(i)
    // oldest 3 dropped, should have 3,4,5,6,7
    expect(buf.toArray()).toEqual([3, 4, 5, 6, 7])
  })

  it('works correctly when exactly at capacity', () => {
    const buf = new CircularBuffer<string>(2)
    buf.push('x')
    buf.push('y')
    expect(buf.toArray()).toEqual(['x', 'y'])
  })

  it('works when pushing one over capacity', () => {
    const buf = new CircularBuffer<string>(2)
    buf.push('x')
    buf.push('y')
    buf.push('z')
    expect(buf.toArray()).toEqual(['y', 'z'])
  })

  it('returns empty array for empty buffer', () => {
    const buf = new CircularBuffer<string>(5)
    expect(buf.toArray()).toEqual([])
    expect(buf.size).toBe(0)
  })

  it('clear resets the buffer', () => {
    const buf = new CircularBuffer<string>(3)
    buf.push('a')
    buf.push('b')
    buf.clear()
    expect(buf.toArray()).toEqual([])
    expect(buf.size).toBe(0)
  })

  it('can push items again after clear', () => {
    const buf = new CircularBuffer<string>(3)
    buf.push('a')
    buf.push('b')
    buf.clear()
    buf.push('c')
    expect(buf.toArray()).toEqual(['c'])
    expect(buf.size).toBe(1)
  })

  it('handles capacity of 1', () => {
    const buf = new CircularBuffer<string>(1)
    buf.push('a')
    expect(buf.toArray()).toEqual(['a'])
    buf.push('b')
    expect(buf.toArray()).toEqual(['b'])
    buf.push('c')
    expect(buf.toArray()).toEqual(['c'])
    expect(buf.size).toBe(1)
  })

  it('handles many overflows correctly', () => {
    const buf = new CircularBuffer<number>(100)
    for (let i = 0; i < 1000; i++) buf.push(i)
    const arr = buf.toArray()
    expect(arr).toHaveLength(100)
    expect(arr[0]).toBe(900)
    expect(arr[99]).toBe(999)
  })

  it('size tracks partial fill correctly', () => {
    const buf = new CircularBuffer<string>(10)
    expect(buf.size).toBe(0)
    buf.push('a')
    expect(buf.size).toBe(1)
    buf.push('b')
    expect(buf.size).toBe(2)
    buf.push('c')
    expect(buf.size).toBe(3)
  })
})
