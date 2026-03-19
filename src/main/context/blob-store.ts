import { createHash } from 'crypto'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'

const BLOB_THRESHOLD = 102_400 // 100KB

export function shouldUseBlob(content: string): boolean {
  return Buffer.byteLength(content, 'utf-8') > BLOB_THRESHOLD
}

export function writeBlob(basePath: string, content: string): { blobPath: string; blobHash: string } {
  const hash = createHash('sha256').update(content, 'utf-8').digest('hex')
  const blobPath = `${hash}.blob`
  const fullPath = join(basePath, blobPath)

  if (!existsSync(basePath)) {
    mkdirSync(basePath, { recursive: true })
  }

  // Content-addressed: skip write if blob already exists
  if (!existsSync(fullPath)) {
    writeFileSync(fullPath, content, 'utf-8')
  }

  return { blobPath, blobHash: hash }
}

export function readBlob(basePath: string, blobPath: string): string {
  return readFileSync(join(basePath, blobPath), 'utf-8')
}
