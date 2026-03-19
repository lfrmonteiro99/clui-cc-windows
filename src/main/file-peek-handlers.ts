import { resolve, normalize, sep, extname } from 'path'
import { existsSync, realpathSync, statSync, readFileSync, openSync, readSync, closeSync } from 'fs'
import { shell } from 'electron'

const MAX_FILE_SIZE = 102_400
const MAX_LINES = 5000
const BINARY_CHECK_BYTES = 8192

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
  '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
  '.cs': 'csharp', '.rb': 'ruby', '.php': 'php', '.swift': 'swift',
  '.kt': 'kotlin', '.scala': 'scala', '.lua': 'lua', '.r': 'r',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'fish',
  '.ps1': 'powershell', '.bat': 'batch',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.xml': 'xml', '.html': 'html', '.css': 'css', '.scss': 'scss',
  '.less': 'less', '.sql': 'sql', '.graphql': 'graphql',
  '.md': 'markdown', '.mdx': 'mdx', '.txt': 'plaintext',
  '.dockerfile': 'dockerfile', '.prisma': 'prisma',
  '.vue': 'vue', '.svelte': 'svelte', '.astro': 'astro',
  '.env': 'dotenv', '.ini': 'ini', '.cfg': 'ini',
  '.lock': 'plaintext', '.log': 'plaintext',
}

export function isPathWithinWorkspace(filePath: string, workingDirectory: string): boolean {
  const resolved = resolve(workingDirectory, filePath)
  let normalizedBase: string
  let normalizedTarget: string
  try { normalizedBase = realpathSync(workingDirectory) } catch { normalizedBase = normalize(workingDirectory) }
  if (existsSync(resolved)) {
    try { normalizedTarget = realpathSync(resolved) } catch { normalizedTarget = normalize(resolved) }
  } else {
    normalizedTarget = normalize(resolved)
  }
  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase
}

function isBinaryFile(filePath: string): boolean {
  const fd = openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(BINARY_CHECK_BYTES)
    const bytesRead = readSync(fd, buf, 0, BINARY_CHECK_BYTES, 0)
    return buf.subarray(0, bytesRead).includes(0)
  } finally {
    closeSync(fd)
  }
}

export function handleFileRead(_event: Electron.IpcMainInvokeEvent, payload: { workingDirectory: string; filePath: string }) {
  const { workingDirectory, filePath } = payload
  const resolved = resolve(workingDirectory, filePath)
  if (!isPathWithinWorkspace(filePath, workingDirectory)) {
    return { ok: false, error: 'outside_workspace', message: 'File is outside the current workspace' }
  }
  if (!existsSync(resolved)) {
    return { ok: false, error: 'not_found', message: `File not found: ${filePath}` }
  }
  const stats = statSync(resolved)
  if (stats.size > MAX_FILE_SIZE) {
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1)
    return { ok: false, error: 'too_large', message: `File is ${sizeMB}MB — maximum preview size is 100KB` }
  }
  try {
    if (isBinaryFile(resolved)) {
      return { ok: false, error: 'binary', message: 'Binary file cannot be displayed' }
    }
  } catch { /* proceed if binary check fails */ }
  let content: string
  try {
    content = readFileSync(resolved, 'utf-8')
  } catch (err: any) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return { ok: false, error: 'permission_denied', message: `Permission denied: ${filePath}` }
    }
    throw err
  }
  let truncated = false
  const lines = content.split('\n')
  if (lines.length > MAX_LINES) {
    content = lines.slice(0, MAX_LINES).join('\n')
    truncated = true
  }
  const ext = extname(resolved).toLowerCase()
  const language = EXT_TO_LANG[ext] || 'plaintext'
  return { ok: true, content, language, lineCount: Math.min(lines.length, MAX_LINES), truncated, fileSize: stats.size }
}

export function handleFileReveal(_event: Electron.IpcMainInvokeEvent, payload: { filePath: string; workingDirectory: string }) {
  const { filePath, workingDirectory } = payload
  if (!isPathWithinWorkspace(filePath, workingDirectory)) return false
  const resolved = resolve(workingDirectory, filePath)
  shell.showItemInFolder(resolved)
  return true
}

export function handleFileOpenExternal(_event: Electron.IpcMainInvokeEvent, payload: { filePath: string; workingDirectory: string }) {
  const { filePath, workingDirectory } = payload
  if (!isPathWithinWorkspace(filePath, workingDirectory)) return false
  const resolved = resolve(workingDirectory, filePath)
  shell.openPath(resolved)
  return true
}
