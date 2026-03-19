import { describe, expect, it } from 'vitest'
import { resolve, join } from 'path'
import { isPathWithinWorkspace } from '../../src/main/file-peek-handlers'

describe('isPathWithinWorkspace', () => {
  const workspace = resolve(__dirname, '../../src')
  it('allows file inside workspace', () => expect(isPathWithinWorkspace('shared/types.ts', workspace)).toBe(true))
  it('allows absolute path inside workspace', () => expect(isPathWithinWorkspace(join(workspace, 'shared/types.ts'), workspace)).toBe(true))
  it('rejects path traversal with ../', () => expect(isPathWithinWorkspace('../../etc/passwd', workspace)).toBe(false))
  it('rejects nested path traversal', () => expect(isPathWithinWorkspace('foo/../../../etc/passwd', workspace)).toBe(false))
  it('rejects absolute path outside workspace', () => expect(isPathWithinWorkspace('/etc/passwd', workspace)).toBe(false))
  it('allows workspace root itself', () => expect(isPathWithinWorkspace('.', workspace)).toBe(true))
})
