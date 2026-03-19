import { describe, expect, it } from 'vitest'
import { isLikelyFilePath } from '../../src/renderer/utils/file-path-detect'

describe('isLikelyFilePath', () => {
  it('matches relative TS path', () => expect(isLikelyFilePath('src/renderer/App.tsx')).toBe(true))
  it('matches dotslash path', () => expect(isLikelyFilePath('./utils/diff.ts')).toBe(true))
  it('matches Windows path', () => expect(isLikelyFilePath('C:\\Users\\foo\\file.ts')).toBe(true))
  it('matches parent path', () => expect(isLikelyFilePath('../shared/types.ts')).toBe(true))
  it('matches absolute unix path', () => expect(isLikelyFilePath('/etc/nginx/nginx.conf')).toBe(true))
  it('matches extensionless known file with separator', () => expect(isLikelyFilePath('src/Makefile')).toBe(true))
  it('rejects URL', () => expect(isLikelyFilePath('https://example.com/path/to/file.ts')).toBe(false))
  it('rejects version string', () => expect(isLikelyFilePath('v2.1.63')).toBe(false))
  it('rejects float', () => expect(isLikelyFilePath('3.14')).toBe(false))
  it('rejects no extension no separator', () => expect(isLikelyFilePath('sometext')).toBe(false))
  it('rejects no extension with separator', () => expect(isLikelyFilePath('some/random/text')).toBe(false))
  it('rejects protocol', () => expect(isLikelyFilePath('ftp://server/file.txt')).toBe(false))
  it('rejects bare filename without separator', () => expect(isLikelyFilePath('package.json')).toBe(false))
})
