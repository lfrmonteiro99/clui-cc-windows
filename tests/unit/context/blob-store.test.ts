import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { shouldUseBlob, writeBlob, readBlob } from '../../../src/main/context/blob-store'

describe('blob-store', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clui-blob-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('shouldUseBlob', () => {
    it('returns false for small content', () => {
      expect(shouldUseBlob('hello')).toBe(false)
    })

    it('returns true for content over 100KB', () => {
      const large = 'x'.repeat(102_401)
      expect(shouldUseBlob(large)).toBe(true)
    })

    it('returns false for exactly 100KB', () => {
      const exact = 'x'.repeat(102_400)
      expect(shouldUseBlob(exact)).toBe(false)
    })
  })

  describe('writeBlob + readBlob', () => {
    it('writes and reads back content', () => {
      const content = 'test blob content'
      const { blobPath, blobHash } = writeBlob(tempDir, content)
      expect(blobHash).toMatch(/^[a-f0-9]{64}$/)
      expect(blobPath).toBe(`${blobHash}.blob`)

      const read = readBlob(tempDir, blobPath)
      expect(read).toBe(content)
    })

    it('creates directory if missing', () => {
      const nested = join(tempDir, 'nested', 'blobs')
      expect(existsSync(nested)).toBe(false)

      writeBlob(nested, 'content')
      expect(existsSync(nested)).toBe(true)
    })

    it('deduplicates by hash', () => {
      const content = 'duplicate content'
      const result1 = writeBlob(tempDir, content)
      const result2 = writeBlob(tempDir, content)
      expect(result1.blobHash).toBe(result2.blobHash)
      expect(result1.blobPath).toBe(result2.blobPath)
    })

    it('produces different hashes for different content', () => {
      const r1 = writeBlob(tempDir, 'content A')
      const r2 = writeBlob(tempDir, 'content B')
      expect(r1.blobHash).not.toBe(r2.blobHash)
    })
  })
})
