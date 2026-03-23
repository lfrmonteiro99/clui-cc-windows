import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { DirtyDetector } from '../dirty-detector'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clui-dirty-test-'))
  git(['init', '-b', 'main'], dir)
  git(['config', 'user.email', 'test@test.com'], dir)
  git(['config', 'user.name', 'Test'], dir)
  writeFileSync(join(dir, 'README.md'), '# Test\n')
  git(['add', '.'], dir)
  git(['commit', '-m', 'initial'], dir)
  return dir
}

describe('DirtyDetector', () => {
  let repoDir: string
  let detector: DirtyDetector

  beforeEach(() => {
    repoDir = initRepo()
    detector = new DirtyDetector()
  })

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true })
  })

  it('reports clean state for a clean repo', async () => {
    const state = await detector.check(repoDir)

    expect(state.isDirty).toBe(false)
    expect(state.untracked).toEqual([])
    expect(state.unstaged).toEqual([])
    expect(state.summary).toBe('clean')
  })

  it('detects modified files', async () => {
    writeFileSync(join(repoDir, 'README.md'), '# Modified\n')

    const state = await detector.check(repoDir)

    expect(state.isDirty).toBe(true)
    expect(state.unstaged.length).toBe(1)
    expect(state.unstaged[0]).toContain('README.md')
    expect(state.summary).toContain('1 modified')
  })

  it('detects untracked files', async () => {
    writeFileSync(join(repoDir, 'newfile.txt'), 'new content\n')

    const state = await detector.check(repoDir)

    expect(state.isDirty).toBe(true)
    expect(state.untracked.length).toBe(1)
    expect(state.untracked[0]).toContain('newfile.txt')
    expect(state.summary).toContain('1 untracked')
  })

  it('detects both modified and untracked files', async () => {
    writeFileSync(join(repoDir, 'README.md'), '# Modified\n')
    writeFileSync(join(repoDir, 'newfile.txt'), 'new\n')

    const state = await detector.check(repoDir)

    expect(state.isDirty).toBe(true)
    expect(state.unstaged.length).toBe(1)
    expect(state.untracked.length).toBe(1)
    expect(state.summary).toContain('modified')
    expect(state.summary).toContain('untracked')
  })

  it('counts stashes in summary', async () => {
    // Create a change and stash it
    writeFileSync(join(repoDir, 'README.md'), '# stash me\n')
    git(['stash', 'push', '-m', 'test stash'], repoDir)

    const state = await detector.check(repoDir)

    // Repo is clean after stash, but stash count should be 1
    expect(state.isDirty).toBe(false)
    expect(state.stashCount).toBe(1)
    expect(state.summary).toContain('1 stash')
  })

  it('autoStash stashes changes and returns stash ref', async () => {
    writeFileSync(join(repoDir, 'README.md'), '# auto stash test\n')

    const ref = await detector.autoStash(repoDir, 'clui auto-stash')

    expect(ref).toBe('stash@{0}')

    // Working dir should be clean now
    const state = await detector.check(repoDir)
    expect(state.isDirty).toBe(false)
    expect(state.stashCount).toBe(1)

    // Restore stash and verify content is preserved
    git(['stash', 'pop'], repoDir)
    const content = readFileSync(join(repoDir, 'README.md'), 'utf-8')
    expect(content.replace(/\r\n/g, '\n')).toBe('# auto stash test\n')
  })
})
