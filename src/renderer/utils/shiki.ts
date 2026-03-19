import type { Highlighter } from 'shiki'

let highlighterPromise: Promise<Highlighter> | null = null

export async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({
        themes: ['github-dark', 'github-light'],
        // Load a base set of languages; additional languages loaded on demand
        langs: [
          'typescript', 'tsx', 'javascript', 'jsx',
          'python', 'rust', 'go', 'java', 'json',
          'yaml', 'toml', 'markdown', 'html', 'css',
          'bash', 'sql', 'plaintext',
        ],
      })
    ).catch((err) => {
      // Reset so next attempt can retry instead of caching a rejected promise
      highlighterPromise = null
      throw err
    })
  }
  return highlighterPromise
}

export async function highlightCode(
  code: string,
  language: string,
  isDark: boolean,
): Promise<string> {
  const highlighter = await getHighlighter()
  const theme = isDark ? 'github-dark' : 'github-light'

  // If language isn't loaded, fall back to plaintext
  const loadedLangs = highlighter.getLoadedLanguages()
  const lang = loadedLangs.includes(language as any) ? language : 'plaintext'

  return highlighter.codeToHtml(code, {
    lang,
    theme,
  })
}
