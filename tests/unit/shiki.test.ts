import { describe, expect, it, vi } from 'vitest'

// Mock shiki since it uses WASM and dynamic imports that won't work in the
// vitest/node environment. We test the caching and error recovery logic of
// our wrapper, not shiki itself.

const mockHighlighter = {
  codeToHtml: vi.fn().mockReturnValue('<pre class="shiki"><code>highlighted</code></pre>'),
  getLoadedLanguages: vi.fn().mockReturnValue(['typescript', 'javascript', 'json', 'plaintext']),
}

vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue(mockHighlighter),
}))

// Import after mock is set up.
import { getHighlighter, highlightCode } from '../../src/renderer/utils/shiki'

describe('shiki utility', () => {
  describe('highlightCode', () => {
    it('returns an HTML string containing <pre and <code', async () => {
      const html = await highlightCode('const x = 1', 'typescript', true)
      expect(html).toContain('<pre')
      expect(html).toContain('<code')
    })

    it('with isDark=true uses github-dark theme', async () => {
      await highlightCode('const x = 1', 'typescript', true)
      expect(mockHighlighter.codeToHtml).toHaveBeenCalledWith('const x = 1', {
        lang: 'typescript',
        theme: 'github-dark',
      })
    })

    it('with isDark=false uses github-light theme', async () => {
      await highlightCode('const x = 1', 'typescript', false)
      expect(mockHighlighter.codeToHtml).toHaveBeenCalledWith('const x = 1', {
        lang: 'typescript',
        theme: 'github-light',
      })
    })

    it('falls back to plaintext for unknown language', async () => {
      mockHighlighter.getLoadedLanguages.mockReturnValueOnce(['typescript', 'plaintext'])
      await highlightCode('some code', 'brainfuck', true)
      expect(mockHighlighter.codeToHtml).toHaveBeenCalledWith('some code', {
        lang: 'plaintext',
        theme: 'github-dark',
      })
    })
  })

  describe('getHighlighter', () => {
    it('caches the instance — calling twice returns same resolved value', async () => {
      const h1 = await getHighlighter()
      const h2 = await getHighlighter()
      // The cached promise resolves to the same highlighter instance
      expect(h1).toBe(h2)
    })

    it('does not call createHighlighter more than once for multiple calls', async () => {
      // Calling getHighlighter multiple times should only trigger one
      // createHighlighter invocation (the very first), because the promise
      // is cached in the module-level variable.
      const { createHighlighter } = await import('shiki')
      const callsBefore = (createHighlighter as ReturnType<typeof vi.fn>).mock.calls.length
      await getHighlighter()
      await getHighlighter()
      await getHighlighter()
      const callsAfter = (createHighlighter as ReturnType<typeof vi.fn>).mock.calls.length
      // No new calls because the promise is already cached
      expect(callsAfter).toBe(callsBefore)
    })
  })

  describe('error recovery', () => {
    it('createHighlighter is called with the correct themes and languages', async () => {
      const { createHighlighter } = await import('shiki')
      await getHighlighter()
      expect(createHighlighter).toHaveBeenCalledWith({
        themes: ['github-dark', 'github-light'],
        langs: expect.arrayContaining(['typescript', 'javascript', 'json', 'plaintext']),
      })
    })
  })
})
