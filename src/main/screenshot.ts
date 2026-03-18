/**
 * Screenshot command builder — platform-aware capture flow.
 */

import { join } from 'path'
import { tmpdir } from 'os'

export interface ScreenshotCommand {
  program: string
  args: string[]
}

let counter = 0

/**
 * Returns a unique temp path for a screenshot file.
 */
export function getScreenshotTempPath(): string {
  return join(tmpdir(), `clui-screenshot-${Date.now()}-${++counter}.png`)
}

/**
 * Build the platform-appropriate screenshot capture command.
 *
 * - macOS: uses `/usr/sbin/screencapture -i` (interactive region select)
 * - Windows: uses SnippingTool.exe /clip (interactive region select → clipboard → file)
 * - Linux: returns null (not supported)
 */
export function buildScreenshotCommand(outputPath: string): ScreenshotCommand | null {
  if (process.platform === 'darwin') {
    return {
      program: '/usr/sbin/screencapture',
      args: ['-i', outputPath],
    }
  }

  if (process.platform === 'win32') {
    const escapedPath = outputPath.replace(/'/g, "''")
    // Use ms-screenclip: URI to open the native screen snip overlay (same as Win+Shift+S).
    // Then poll the clipboard every 500ms for up to 30s waiting for the user to complete the snip.
    // If user cancels (Escape), clipboard stays empty → file won't be created.
    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      'Add-Type -AssemblyName System.Drawing;',
      '[System.Windows.Forms.Clipboard]::Clear();',
      'Start-Process "explorer.exe" "ms-screenclip:";',
      'Start-Sleep -Milliseconds 800;',
      '$timeout = 60; $elapsed = 0;',
      'while ($elapsed -lt $timeout) {',
      '  Start-Sleep -Milliseconds 500;',
      '  $elapsed += 1;',
      '  $img = [System.Windows.Forms.Clipboard]::GetImage();',
      '  if ($img) {',
      `    $img.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png);`,
      '    $img.Dispose();',
      '    break',
      '  }',
      '}',
    ].join(' ')

    return {
      program: 'powershell',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    }
  }

  return null
}
