#!/usr/bin/env node
const { spawnSync } = require('child_process')
const path = require('path')

function run(command, args, { failOk = false } = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true })

  if (result.error) {
    console.warn(`[postinstall] ${command} skipped: ${result.error.message}`)
    if (!failOk) process.exit(0)
    return false
  }

  if ((result.status ?? 0) !== 0) {
    if (failOk) {
      console.warn(`[postinstall] ${command} failed (non-fatal, status=${result.status})`)
      return false
    }
    process.exit(result.status ?? 1)
  }
  return true
}

const isCi = /^(1|true)$/i.test(process.env.CI ?? '')

if (isCi) {
  console.log('[postinstall] skipping native module rebuild in CI')
  process.exit(0)
}

// Rebuild better-sqlite3 for Electron's Node version.
// We use node-gyp directly because electron-builder install-app-deps
// also tries to rebuild node-pty, which fails on Windows (winpty bug).
const electronVersion = require('electron/package.json').version
const betterSqlite3Dir = path.resolve(__dirname, '..', 'node_modules', 'better-sqlite3')
const nodeGyp = path.resolve(__dirname, '..', 'node_modules', '.bin', 'node-gyp')

console.log(`[postinstall] rebuilding better-sqlite3 for Electron ${electronVersion}`)
const rebuilt = run(nodeGyp, [
  'rebuild',
  `--directory=${betterSqlite3Dir}`,
  `--target=${electronVersion}`,
  '--arch=x64',
  '--dist-url=https://electronjs.org/headers',
])

if (!rebuilt) {
  // Fallback: try electron-builder install-app-deps (may fail on node-pty)
  console.warn('[postinstall] node-gyp direct rebuild failed, trying install-app-deps...')
  run(process.execPath, [
    require.resolve('electron-builder/out/cli/cli.js'),
    'install-app-deps',
  ], { failOk: true })
}

if (process.platform === 'darwin') {
  run('bash', ['scripts/patch-dev-icon.sh'])
}
