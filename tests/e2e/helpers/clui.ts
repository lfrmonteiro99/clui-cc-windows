import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import type { Page, TestInfo } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { _electron as electron } from 'playwright'

export interface CluiAppSession {
  electronApp: ElectronApplication
  page: Page
  homeDir: string
  settingsPath: string
}

export function createIsolatedHome(testInfo: TestInfo): {
  homeDir: string
  appDataDir: string
  localAppDataDir: string
  settingsPath: string
} {
  const homeDir = testInfo.outputPath('home')
  const appDataDir = path.join(homeDir, 'AppData', 'Roaming')
  const localAppDataDir = path.join(homeDir, 'AppData', 'Local')
  const settingsPath = path.join(homeDir, '.claude', 'settings.json')

  fs.mkdirSync(appDataDir, { recursive: true })
  fs.mkdirSync(localAppDataDir, { recursive: true })
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })

  return { homeDir, appDataDir, localAppDataDir, settingsPath }
}

export interface LaunchOptions {
  homeDir?: string
  /** Use the fake-claude-permissions.cjs fixture that emits permission_request events */
  withPermissions?: boolean
}

export async function launchCluiApp(testInfo: TestInfo, homeDirOrOptions?: string | LaunchOptions): Promise<CluiAppSession> {
  const opts: LaunchOptions = typeof homeDirOrOptions === 'string'
    ? { homeDir: homeDirOrOptions }
    : homeDirOrOptions ?? {}
  const homeDir = opts.homeDir
  const isolated = homeDir
    ? {
        homeDir,
        appDataDir: path.join(homeDir, 'AppData', 'Roaming'),
        localAppDataDir: path.join(homeDir, 'AppData', 'Local'),
        settingsPath: path.join(homeDir, '.claude', 'settings.json'),
      }
    : createIsolatedHome(testInfo)

  fs.mkdirSync(isolated.appDataDir, { recursive: true })
  fs.mkdirSync(isolated.localAppDataDir, { recursive: true })
  fs.mkdirSync(path.dirname(isolated.settingsPath), { recursive: true })

  // Always pass --no-sandbox in CI to avoid AppArmor/namespace restrictions
  // on Ubuntu 24.04+ and headless Windows runners.
  // --disable-gpu prevents GPU process crashes in headless/virtual framebuffer environments.
  const ciArgs = process.env.CI || process.env.ELECTRON_DISABLE_SANDBOX
    ? ['--no-sandbox', '--disable-gpu-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '.']
    : ['.']
  const electronApp = await electron.launch({
    args: ciArgs,
    cwd: process.cwd(),
    env: {
      ...process.env,
      CI: '1',
      CLUI_E2E: '1',
      CLUI_CLAUDE_BIN: process.execPath,
      CLUI_CLAUDE_NODE_SCRIPT: path.join(process.cwd(), 'tests', 'e2e', 'fixtures', opts.withPermissions ? 'fake-claude-permissions.cjs' : 'fake-claude.cjs'),
      HOME: isolated.homeDir,
      USERPROFILE: isolated.homeDir,
      HOMEDRIVE: path.parse(isolated.homeDir).root.replace(/[/\\]$/, ''),
      HOMEPATH: isolated.homeDir.slice(path.parse(isolated.homeDir).root.length - 1),
      APPDATA: isolated.appDataDir,
      LOCALAPPDATA: isolated.localAppDataDir,
      CLUI_SETTINGS_PATH: isolated.settingsPath,
      // Ensure Electron doesn't try to use hardware GPU in CI
      ELECTRON_DISABLE_GPU: '1',
    },
  })

  const page = await electronApp.firstWindow({ timeout: 30_000 })
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })

  return {
    electronApp,
    page,
    homeDir: isolated.homeDir,
    settingsPath: isolated.settingsPath,
  }
}

export async function dismissPermissionWizard(page: Page): Promise<void> {
  const wizard = page.getByTestId('permission-wizard')
  if (await wizard.count()) {
    await page.getByTestId('permission-wizard-apply').click()
    await wizard.waitFor({ state: 'detached' })
  }
}
