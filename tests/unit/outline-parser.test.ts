import { describe, it, expect } from 'vitest'
import { parseOutline, detectStepProgress } from '../../src/shared/outline-parser'

describe('parseOutline', () => {
  it('extracts ## headers', () => {
    const text = '## Summary\nSome text\n## Implementation\nMore text'
    const entries = parseOutline(text)
    expect(entries).toHaveLength(2)
    expect(entries[0].text).toBe('Summary')
    expect(entries[0].level).toBe(2)
    expect(entries[1].text).toBe('Implementation')
    expect(entries[1].level).toBe(2)
  })

  it('extracts mixed ## and ### levels', () => {
    const text = '## Overview\nIntro\n### Details\nBody\n## Conclusion\nEnd'
    const entries = parseOutline(text)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ level: 2, text: 'Overview' })
    expect(entries[1]).toMatchObject({ level: 3, text: 'Details' })
    expect(entries[2]).toMatchObject({ level: 2, text: 'Conclusion' })
  })

  it('returns empty array when no headers present', () => {
    const text = 'Just some plain text\nwith no headers at all.'
    expect(parseOutline(text)).toEqual([])
  })

  it('marks the last entry as active', () => {
    const text = '## First\ntext\n## Second\ntext\n## Third\ntext'
    const entries = parseOutline(text)
    expect(entries).toHaveLength(3)
    expect(entries[0].isActive).toBe(false)
    expect(entries[1].isActive).toBe(false)
    expect(entries[2].isActive).toBe(true)
  })

  it('parses 1-2 headers (component threshold is separate)', () => {
    const text = '## Only One\ntext'
    const entries = parseOutline(text)
    expect(entries).toHaveLength(1)
    expect(entries[0].text).toBe('Only One')
    expect(entries[0].isActive).toBe(true)
  })

  it('records correct char offsets', () => {
    const text = '## Alpha\nfoo\n## Beta\nbar'
    const entries = parseOutline(text)
    expect(entries[0].offset).toBe(0)
    expect(entries[1].offset).toBe(text.indexOf('## Beta'))
  })

  it('strips inline markdown formatting from header text', () => {
    const text = '## **Bold** and _italic_ `code`\ntext'
    const entries = parseOutline(text)
    expect(entries[0].text).toBe('Bold and italic code')
  })

  it('handles # (h1) through #### (h4)', () => {
    const text = '# H1\n## H2\n### H3\n#### H4\n##### H5 should be ignored'
    const entries = parseOutline(text)
    // ##### has 5 hashes — regex only matches 1-4
    expect(entries).toHaveLength(4)
    expect(entries[0].level).toBe(1)
    expect(entries[1].level).toBe(2)
    expect(entries[2].level).toBe(3)
    expect(entries[3].level).toBe(4)
  })

  it('handles a real-world streaming markdown response', () => {
    const text = [
      '## Summary',
      '',
      'Here is what I found after analyzing the codebase.',
      '',
      '## Implementation Plan',
      '',
      '### Step 1: Create the parser',
      '',
      'We need a function that extracts headers.',
      '',
      '### Step 2: Build the component',
      '',
      'A floating outline widget.',
      '',
      '## Testing',
      '',
      '1. Unit tests for parser',
      '2. Component rendering tests',
      '3. Integration tests',
    ].join('\n')

    const entries = parseOutline(text)
    expect(entries).toHaveLength(5)
    expect(entries.map((e) => e.text)).toEqual([
      'Summary',
      'Implementation Plan',
      'Step 1: Create the parser',
      'Step 2: Build the component',
      'Testing',
    ])
    expect(entries[4].isActive).toBe(true)
    expect(entries[0].isActive).toBe(false)
  })
})

describe('detectStepProgress', () => {
  it('detects a numbered list', () => {
    const text = '1. First\n2. Second\n3. Third'
    const progress = detectStepProgress(text)
    expect(progress).not.toBeNull()
    expect(progress!.current).toBe(3)
  })

  it('returns null when no numbered list present', () => {
    const text = 'Just regular text\nwith no numbers.'
    expect(detectStepProgress(text)).toBeNull()
  })

  it('estimates total as current + 2 for sequential lists', () => {
    const text = '1. First\n2. Second\n3. Third'
    const progress = detectStepProgress(text)!
    expect(progress.current).toBe(3)
    expect(progress.estimated).toBe(5) // 3 + 2
  })

  it('uses max number as estimate when numbers skip', () => {
    // e.g., step numbers jump: 1, 2, 5
    const text = '1. First\n2. Second\n5. Fifth'
    const progress = detectStepProgress(text)!
    expect(progress.current).toBe(3) // 3 items found
    expect(progress.estimated).toBe(5) // max number is 5, which is > 3
  })

  it('handles single step', () => {
    const text = '1. Only step so far...'
    const progress = detectStepProgress(text)!
    expect(progress.current).toBe(1)
    expect(progress.estimated).toBe(3) // 1 + 2
  })

  it('handles steps mixed with other content', () => {
    const text = [
      '## Steps',
      '',
      '1. First step',
      '',
      'Some explanation here.',
      '',
      '2. Second step',
      '',
      'More explanation.',
      '',
      '3. Third step',
    ].join('\n')

    const progress = detectStepProgress(text)!
    expect(progress.current).toBe(3)
  })
})
