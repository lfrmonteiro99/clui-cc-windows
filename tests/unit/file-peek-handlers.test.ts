import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { resolve, join } from 'path'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { handleFileRead } from '../../src/main/file-peek-handlers'

const ROOT = resolve(__dirname, '../..')
const TMP_DIR = join(ROOT, 'tests', '.tmp-file-peek')

function invoke(filePath: string, workingDirectory: string = ROOT) {
  return handleFileRead(null as any, { workingDirectory, filePath })
}

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true })
})

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true })
})

describe('handleFileRead', () => {
  // ─── Success cases ───

  it('reads a real file successfully', () => {
    const result = invoke('package.json')
    expect(result.ok).toBe(true)
    expect(result.content).toBeDefined()
    expect(result.content).toContain('"name"')
  })

  it('returns correct language for known extensions', () => {
    const cases: [string, string][] = [
      ['src/main/file-peek-handlers.ts', 'typescript'],
      ['package.json', 'json'],
      ['tsconfig.json', 'json'],
    ]
    for (const [filePath, expectedLang] of cases) {
      const result = invoke(filePath)
      expect(result.ok).toBe(true)
      expect(result.language).toBe(expectedLang)
    }
  })

  it('returns plaintext for unknown extensions', () => {
    const unknownFile = join(TMP_DIR, 'test.xyz')
    writeFileSync(unknownFile, 'hello world')
    const result = invoke(unknownFile, ROOT)
    expect(result.ok).toBe(true)
    expect(result.language).toBe('plaintext')
  })

  it('returns correct lineCount and fileSize', () => {
    const testFile = join(TMP_DIR, 'lines.txt')
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`)
    writeFileSync(testFile, lines.join('\n'))
    const result = invoke(testFile, ROOT)
    expect(result.ok).toBe(true)
    expect(result.lineCount).toBe(10)
    expect(result.fileSize).toBeGreaterThan(0)
    expect(result.truncated).toBe(false)
  })

  // ─── Truncation ───

  it('truncates files with more than 5000 lines', () => {
    const bigFile = join(TMP_DIR, 'big.txt')
    const lines = Array.from({ length: 6000 }, (_, i) => `line ${i + 1}`)
    writeFileSync(bigFile, lines.join('\n'))
    const result = invoke(bigFile, ROOT)
    expect(result.ok).toBe(true)
    expect(result.lineCount).toBe(5000)
    expect(result.truncated).toBe(true)
    // Content should only contain first 5000 lines
    const contentLines = (result.content as string).split('\n')
    expect(contentLines.length).toBe(5000)
    expect(contentLines[0]).toBe('line 1')
    expect(contentLines[4999]).toBe('line 5000')
  })

  // ─── Error cases ───

  it('returns not_found for nonexistent file', () => {
    const result = invoke('this-file-does-not-exist-at-all.ts')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('not_found')
  })

  it('returns outside_workspace for path traversal attempts', () => {
    const result = invoke('../../etc/passwd')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('outside_workspace')
  })

  it('returns outside_workspace for absolute path outside workspace', () => {
    const result = invoke('/etc/passwd', ROOT)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('outside_workspace')
  })

  it('returns binary error for binary files', () => {
    const binFile = join(TMP_DIR, 'test.bin')
    // Write bytes including null bytes to trigger binary detection
    const buf = Buffer.alloc(256)
    for (let i = 0; i < 256; i++) buf[i] = i
    writeFileSync(binFile, buf)
    const result = invoke(binFile, ROOT)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('binary')
  })

  it('returns too_large error for files over 100KB', () => {
    const largeFile = join(TMP_DIR, 'large.txt')
    // 102401 bytes > 102400 (MAX_FILE_SIZE)
    writeFileSync(largeFile, 'x'.repeat(102_401))
    const result = invoke(largeFile, ROOT)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('too_large')
    expect(result.message).toContain('MB')
  })
})
