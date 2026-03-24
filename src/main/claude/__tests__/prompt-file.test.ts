import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { writePromptFile, cleanupPromptFile, cleanOrphanedPromptFiles, buildPromptArgs, PROMPT_FILE_DIR } from '../prompt-file'

describe('writePromptFile', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(PROMPT_FILE_DIR, { recursive: true, force: true })
  })

  it('writes file with correct content and returns path', () => {
    const content = 'You are inside CLUI.\n\nContext memory here.'
    const result = writePromptFile('run-001', content)

    expect(result).toBe(join(PROMPT_FILE_DIR, 'run-001.prompt.txt'))
    expect(existsSync(result!)).toBe(true)
    expect(readFileSync(result!, 'utf-8')).toBe(content)
  })

  it('file content matches input exactly — no encoding artifacts', () => {
    const content = 'Émojis: 🧠 Ação — "quotes" <tags> \n\ttabs'
    const result = writePromptFile('run-unicode', content)

    expect(readFileSync(result!, 'utf-8')).toBe(content)
  })

  it('returns null when writeFileSync throws', async () => {
    vi.resetModules()

    vi.doMock('fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('fs')>()
      return {
        ...actual,
        writeFileSync: () => {
          throw new Error('ENOSPC: no space left on device')
        },
      }
    })

    const { writePromptFile: writePromptFileMocked } = await import('../prompt-file')
    const result = writePromptFileMocked('run-fail', 'content')
    expect(result).toBeNull()
  })
})

describe('cleanupPromptFile', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(PROMPT_FILE_DIR, { recursive: true, force: true })
  })

  it('deletes an existing file', () => {
    const path = writePromptFile('run-cleanup', 'test content')!
    expect(existsSync(path)).toBe(true)

    cleanupPromptFile(path)
    expect(existsSync(path)).toBe(false)
  })

  it('no-ops on missing file without throwing', () => {
    const fakePath = join(PROMPT_FILE_DIR, 'nonexistent.prompt.txt')
    expect(() => cleanupPromptFile(fakePath)).not.toThrow()
  })

  it('no-ops when path is null', () => {
    expect(() => cleanupPromptFile(null)).not.toThrow()
  })
})

describe('cleanOrphanedPromptFiles', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(PROMPT_FILE_DIR, { recursive: true, force: true })
  })

  it('clears all .prompt.txt files in directory', () => {
    writePromptFile('orphan-1', 'content 1')
    writePromptFile('orphan-2', 'content 2')
    writePromptFile('orphan-3', 'content 3')

    expect(readdirSync(PROMPT_FILE_DIR)).toHaveLength(3)

    cleanOrphanedPromptFiles()
    expect(readdirSync(PROMPT_FILE_DIR)).toHaveLength(0)
    expect(existsSync(PROMPT_FILE_DIR)).toBe(true)
  })

  it('no-ops when directory does not exist', () => {
    expect(() => cleanOrphanedPromptFiles()).not.toThrow()
  })
})

describe('buildPromptArgs', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(PROMPT_FILE_DIR, { recursive: true, force: true })
  })

  it('returns --append-system-prompt-file for native runs', () => {
    const result = buildPromptArgs('run-native', 'system prompt content', false)

    expect(result.args).toEqual(['--append-system-prompt-file', result.filePath!])
    expect(result.filePath).toBe(join(PROMPT_FILE_DIR, 'run-native.prompt.txt'))
    expect(existsSync(result.filePath!)).toBe(true)
  })

  it('returns --append-system-prompt for WSL runs (always inline)', () => {
    const result = buildPromptArgs('run-wsl', 'system prompt content', true)

    expect(result.args).toEqual(['--append-system-prompt', 'system prompt content'])
    expect(result.filePath).toBeNull()
  })

  it('falls back to inline --append-system-prompt when file write fails', async () => {
    vi.resetModules()

    vi.doMock('fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('fs')>()
      return {
        ...actual,
        writeFileSync: () => {
          throw new Error('EACCES: permission denied')
        },
      }
    })

    const { buildPromptArgs: buildPromptArgsMocked } = await import('../prompt-file')
    const result = buildPromptArgsMocked('run-fallback', 'prompt content', false)

    expect(result.args).toEqual(['--append-system-prompt', 'prompt content'])
    expect(result.filePath).toBeNull()
  })

  it('returns empty args and null filePath when content is empty', () => {
    const result = buildPromptArgs('run-empty', '', false)

    expect(result.args).toEqual([])
    expect(result.filePath).toBeNull()
  })
})
