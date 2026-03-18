/**
 * Auto-download whisper.cpp binary + model on first boot.
 * Non-blocking — runs in background, broadcasts progress to renderer.
 */

import { existsSync, mkdirSync, createWriteStream, renameSync, unlinkSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { net } from 'electron'
import { log } from './logger'

// ─── Config ───

const WHISPER_DIR = join(homedir(), '.clui', 'whisper')
const WHISPER_BIN = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
const WHISPER_BIN_PATH = join(WHISPER_DIR, WHISPER_BIN)
const MODEL_NAME = 'ggml-base.bin'
const MODEL_PATH = join(WHISPER_DIR, MODEL_NAME)

const WHISPER_VERSION = 'v1.8.3'
const BIN_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`

export interface WhisperProvisionStatus {
  stage: 'checking' | 'downloading-binary' | 'downloading-model' | 'extracting' | 'ready' | 'error' | 'skipped'
  progress?: number // 0-100
  error?: string
}

type StatusCallback = (status: WhisperProvisionStatus) => void

// ─── Public API ───

/**
 * Ensure whisper binary + model exist in ~/.clui/whisper/.
 * Downloads if missing. Non-blocking, reports progress via callback.
 */
export async function ensureWhisper(onStatus: StatusCallback): Promise<void> {
  // macOS: whisper.cpp doesn't publish pre-built macOS binaries — skip auto-download
  if (process.platform === 'darwin') {
    if (!existsSync(WHISPER_BIN_PATH)) {
      onStatus({ stage: 'skipped' })
      log('[WhisperProvisioner] macOS — no pre-built binary, skipping auto-download')
    } else {
      onStatus({ stage: 'ready' })
    }
    return
  }

  onStatus({ stage: 'checking' })

  try {
    mkdirSync(WHISPER_DIR, { recursive: true })
  } catch {
    // directory may already exist
  }

  const hasBinary = existsSync(WHISPER_BIN_PATH)
  const hasModel = existsSync(MODEL_PATH)

  if (hasBinary && hasModel) {
    log('[WhisperProvisioner] Already installed')
    onStatus({ stage: 'ready' })
    return
  }

  // Download binary if missing
  if (!hasBinary) {
    log(`[WhisperProvisioner] Downloading binary from ${BIN_URL}`)
    onStatus({ stage: 'downloading-binary', progress: 0 })

    try {
      const zipPath = join(WHISPER_DIR, 'whisper-bin.zip')
      await downloadFile(BIN_URL, zipPath, (progress) => {
        onStatus({ stage: 'downloading-binary', progress })
      })

      onStatus({ stage: 'extracting' })
      await extractWhisperBinary(zipPath, WHISPER_DIR)
      unlinkSync(zipPath)
      log('[WhisperProvisioner] Binary installed')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`[WhisperProvisioner] Binary download failed: ${msg}`)
      onStatus({ stage: 'error', error: `Failed to download whisper binary: ${msg}` })
      return
    }
  }

  // Download model if missing
  if (!hasModel) {
    log(`[WhisperProvisioner] Downloading model from ${MODEL_URL}`)
    onStatus({ stage: 'downloading-model', progress: 0 })

    try {
      const tmpPath = MODEL_PATH + '.tmp'
      await downloadFile(MODEL_URL, tmpPath, (progress) => {
        onStatus({ stage: 'downloading-model', progress })
      })
      renameSync(tmpPath, MODEL_PATH)
      log('[WhisperProvisioner] Model installed')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`[WhisperProvisioner] Model download failed: ${msg}`)
      onStatus({ stage: 'error', error: `Failed to download whisper model: ${msg}` })
      return
    }
  }

  onStatus({ stage: 'ready' })
  log('[WhisperProvisioner] Provisioning complete')
}

// ─── Download with progress ───

function downloadFile(url: string, destPath: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request(url)

    request.on('response', (response) => {
      // Follow redirects (GitHub → S3, HuggingFace → CDN)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location
        downloadFile(redirectUrl, destPath, onProgress).then(resolve).catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }

      const contentLength = parseInt(
        (Array.isArray(response.headers['content-length']) ? response.headers['content-length'][0] : response.headers['content-length']) || '0',
        10,
      )

      const file = createWriteStream(destPath)
      let received = 0

      response.on('data', (chunk) => {
        file.write(chunk)
        received += chunk.length
        if (contentLength > 0) {
          onProgress(Math.round((received / contentLength) * 100))
        }
      })

      response.on('end', () => {
        file.end(() => resolve())
      })

      response.on('error', (err) => {
        file.close()
        reject(err)
      })
    })

    request.on('error', reject)
    request.end()
  })
}

// ─── Extract binary from zip ───

async function extractWhisperBinary(zipPath: string, destDir: string): Promise<void> {
  // Use PowerShell on Windows to extract zip
  if (process.platform === 'win32') {
    const { execSync } = await import('child_process')
    const extractDir = join(destDir, '_extract')
    try {
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${extractDir}'"`,
        { timeout: 30000, stdio: 'ignore' },
      )

      // Find whisper-cli.exe in extracted files (may be in a subdirectory)
      const binName = 'whisper-cli.exe'
      const found = findFileRecursive(extractDir, binName)
      if (found) {
        renameSync(found, join(destDir, binName))
      } else {
        throw new Error(`${binName} not found in zip`)
      }

      // Clean up extract directory
      execSync(`rmdir /s /q "${extractDir}"`, { timeout: 10000, stdio: 'ignore', shell: true })
    } catch (err) {
      // Clean up on failure
      try { execSync(`rmdir /s /q "${extractDir}"`, { timeout: 5000, stdio: 'ignore', shell: true }) } catch { /* ignore */ }
      throw err
    }
    return
  }

  // macOS/Linux: use unzip
  const { execSync } = await import('child_process')
  execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { timeout: 30000, stdio: 'ignore' })
}

function findFileRecursive(dir: string, fileName: string): string | null {
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isFile() && entry.name === fileName) return fullPath
      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, fileName)
        if (found) return found
      }
    }
  } catch { /* ignore */ }
  return null
}
