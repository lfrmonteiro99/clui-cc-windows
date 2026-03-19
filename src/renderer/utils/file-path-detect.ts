const KNOWN_EXTENSIONLESS = new Set([
  'Makefile', 'Dockerfile', 'Vagrantfile', 'Gemfile',
  'Rakefile', 'Procfile', 'Brewfile',
])

export function isLikelyFilePath(text: string): boolean {
  if (!text.includes('/') && !text.includes('\\')) return false
  if (/^https?:\/\//i.test(text)) return false
  if (text.includes('://')) return false
  const basename = text.split(/[/\\]/).pop() || ''
  if (KNOWN_EXTENSIONLESS.has(basename)) return true
  if (!/\.\w{1,6}$/.test(text)) return false
  if (/^v?\d+\.\d+/.test(text)) return false
  if (/^\d+\.\d+$/.test(text)) return false
  return true
}
