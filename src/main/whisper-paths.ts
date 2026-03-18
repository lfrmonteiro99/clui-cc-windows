/**
 * Platform-aware Whisper binary and model path resolution.
 *
 * Provides candidate paths and error messages appropriate for each platform.
 */

import { homedir } from 'os'
import { join } from 'path'

function isWin(): boolean {
  return process.platform === 'win32'
}

/**
 * Return platform-appropriate candidate paths for the Whisper binary.
 */
export function getWhisperBinaryCandidates(): string[] {
  const home = homedir()

  // Auto-provisioned path (highest priority)
  const cluiWhisper = join(home, '.clui', 'whisper', isWin() ? 'whisper-cli.exe' : 'whisper-cli')

  if (isWin()) {
    return [
      cluiWhisper,
      join(home, 'scoop', 'shims', 'whisper-cli.exe'),
      join(home, 'scoop', 'shims', 'whisper.exe'),
      join(home, 'AppData', 'Local', 'Programs', 'whisper-cli', 'whisper-cli.exe'),
      join(home, 'AppData', 'Local', 'Programs', 'whisper', 'whisper.exe'),
      'C:\\Program Files\\whisper-cpp\\whisper-cli.exe',
      'C:\\Program Files\\whisper\\whisper.exe',
      join(home, '.local', 'bin', 'whisper.exe'),
      join(home, '.local', 'bin', 'whisper'),
    ]
  }

  return [
    cluiWhisper,
    '/opt/homebrew/bin/whisper-cli',
    '/usr/local/bin/whisper-cli',
    '/opt/homebrew/bin/whisper',
    '/usr/local/bin/whisper',
    join(home, '.local/bin/whisper'),
  ]
}

/**
 * Return platform-appropriate candidate paths for Whisper model files.
 */
export function getWhisperModelCandidates(): string[] {
  const home = homedir()
  const models = ['ggml-tiny.bin', 'ggml-base.bin', 'ggml-tiny.en.bin', 'ggml-base.en.bin']

  // Auto-provisioned path (highest priority)
  const cluiDir = join(home, '.clui', 'whisper')

  if (isWin()) {
    const dirs = [
      cluiDir,
      join(home, 'AppData', 'Local', 'whisper', 'models'),
      join(home, '.local', 'share', 'whisper'),
      join(home, 'scoop', 'apps', 'whisper-cpp', 'current', 'models'),
    ]
    return dirs.flatMap(dir => models.map(m => join(dir, m)))
  }

  const dirs = [
    cluiDir,
    join(home, '.local/share/whisper'),
    '/opt/homebrew/share/whisper-cpp/models',
  ]
  return dirs.flatMap(dir => models.map(m => join(dir, m)))
}

/**
 * Return a platform-appropriate "whisper not found" error message.
 */
export function getWhisperNotFoundMessage(): string {
  if (isWin()) {
    return 'Whisper not found. Install via scoop (scoop install whisper-cpp) or download from https://github.com/ggerganov/whisper.cpp/releases'
  }
  return 'Whisper not found. Install with: brew install whisper-cpp'
}

/**
 * Return a platform-appropriate model download instruction.
 */
export function getModelDownloadMessage(): string {
  const url = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin'

  if (isWin()) {
    const modelDir = join(homedir(), 'AppData', 'Local', 'whisper', 'models')
    return `Whisper model not found. Download with PowerShell:\nNew-Item -ItemType Directory -Force -Path "${modelDir}"\nInvoke-WebRequest -Uri ${url} -OutFile "${join(modelDir, 'ggml-tiny.bin')}"`
  }

  return `Whisper model not found. Download with:\nmkdir -p ~/.local/share/whisper && curl -L -o ~/.local/share/whisper/ggml-tiny.bin ${url}`
}
