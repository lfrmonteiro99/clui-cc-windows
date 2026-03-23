import { readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import type { DirectoryListing, FileTreeEntry } from '../../shared/sandbox-types'
import { gitExec } from './git-exec'
import { log as _log } from '../logger'

function log(msg: string): void {
  _log('FileLister', msg)
}

const MAX_ENTRIES = 500
const SKIP_NAMES = new Set(['node_modules', '.clui-sandboxes'])

function isHidden(name: string): boolean {
  // Skip dotfiles/dotdirs except .gitignore
  return name.startsWith('.') && name !== '.gitignore'
}

export class FileLister {
  /**
   * List directory contents with git status annotations.
   * Skips hidden entries (except .gitignore), node_modules, and .clui-sandboxes.
   * Sorts: directories first, then alphabetical.
   * Truncates at 500 entries.
   */
  async list(cwd: string, relativePath?: string): Promise<DirectoryListing> {
    const targetDir = relativePath ? join(cwd, relativePath) : cwd
    log(`listing ${targetDir}`)

    // Get git status map for the repo root
    const statusMap = await this.getStatusMap(cwd)

    let dirEntries: Array<{ name: string; isDirectory: boolean }>
    try {
      const raw = readdirSync(targetDir, { withFileTypes: true })
      dirEntries = raw
        .filter((d) => !isHidden(d.name) && !SKIP_NAMES.has(d.name))
        .map((d) => ({ name: d.name, isDirectory: d.isDirectory() }))
    } catch (err) {
      log(`readdir failed: ${err}`)
      return { basePath: targetDir, entries: [], truncated: false }
    }

    // Sort: directories first, then alphabetical
    dirEntries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    const truncated = dirEntries.length > MAX_ENTRIES
    if (truncated) {
      dirEntries = dirEntries.slice(0, MAX_ENTRIES)
    }

    const entries: FileTreeEntry[] = dirEntries.map((d) => {
      const fullPath = join(targetDir, d.name)
      const relPath = relative(cwd, fullPath).replace(/\\/g, '/')
      let size: number | undefined
      if (!d.isDirectory) {
        try {
          size = statSync(fullPath).size
        } catch {
          // Ignore stat errors
        }
      }

      return {
        name: d.name,
        path: relPath,
        type: d.isDirectory ? 'directory' : 'file',
        size,
        gitStatus: statusMap.get(relPath) ?? null,
      }
    })

    return { basePath: targetDir, entries, truncated }
  }

  /**
   * Build a map of relative paths to git status codes.
   */
  private async getStatusMap(cwd: string): Promise<Map<string, FileTreeEntry['gitStatus']>> {
    const map = new Map<string, FileTreeEntry['gitStatus']>()
    try {
      const raw = await gitExec(['status', '--porcelain'], cwd)
      for (const line of raw.split('\n').filter((l) => l.length > 0)) {
        const xy = line.slice(0, 2)
        const path = line.slice(3).replace(/\\/g, '/')
        if (xy === '??') {
          map.set(path, '?')
        } else if (xy[0] === 'A' || xy[1] === 'A') {
          map.set(path, 'A')
        } else if (xy[0] === 'D' || xy[1] === 'D') {
          map.set(path, 'D')
        } else if (xy[0] === 'M' || xy[1] === 'M') {
          map.set(path, 'M')
        }
      }
    } catch {
      // Not a git repo or git error, return empty map
    }
    return map
  }
}
