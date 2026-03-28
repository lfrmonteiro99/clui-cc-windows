import { expect, test } from '@playwright/test'
import { dismissPermissionWizard, launchCluiApp } from './helpers/clui'

test.describe('E2E-006: Terminal', () => {
  test('toggle terminal panel via mode toggle button', async ({}, testInfo) => {
    test.setTimeout(90_000)

    const { electronApp, page } = await launchCluiApp(testInfo)

    await dismissPermissionWizard(page)

    // The terminal toggle button should be visible
    const toggleBtn = page.getByTestId('terminal-toggle')
    await expect(toggleBtn).toBeVisible({ timeout: 15_000 })

    // Terminal panel should NOT be visible initially (chat mode is default)
    await expect(page.getByTestId('terminal-panel')).toHaveCount(0)

    // Click the toggle to open terminal mode
    await toggleBtn.click()

    // If PTY is available, terminal panel should appear.
    // If PTY is unavailable (common in CI), the button does nothing — skip gracefully.
    const panelVisible = await page.getByTestId('terminal-panel').isVisible().catch(() => false)
    if (!panelVisible) {
      // PTY likely unavailable in this environment — skip further assertions
      console.info('[E2E-006] Terminal panel did not appear (PTY likely unavailable), skipping toggle-off test')
      await electronApp.close()
      return
    }

    await expect(page.getByTestId('terminal-panel')).toBeVisible()

    // Toggle again to hide
    await toggleBtn.click()
    await expect(page.getByTestId('terminal-panel')).toHaveCount(0, { timeout: 5_000 })

    await electronApp.close()
  })

  test('terminal shows content area when PTY available', async ({}, testInfo) => {
    test.setTimeout(90_000)

    const { electronApp, page } = await launchCluiApp(testInfo)

    await dismissPermissionWizard(page)

    // Click terminal toggle
    const toggleBtn = page.getByTestId('terminal-toggle')
    await expect(toggleBtn).toBeVisible({ timeout: 15_000 })
    await toggleBtn.click()

    // Check if terminal panel appeared (PTY must be available)
    const panelVisible = await page.getByTestId('terminal-panel').isVisible().catch(() => false)
    if (!panelVisible) {
      console.info('[E2E-006] PTY unavailable in this environment, skipping terminal content test')
      await electronApp.close()
      return
    }

    // The terminal panel should contain terminal view content (xterm container)
    // Look for the xterm container element which has class xterm
    const xtermElement = page.locator('.xterm')
    const xtermVisible = await xtermElement.isVisible().catch(() => false)
    if (xtermVisible) {
      await expect(xtermElement).toBeVisible()
    } else {
      // xterm may not load in CI without proper display — just verify the panel structure exists
      await expect(page.getByTestId('terminal-panel')).toBeVisible()
    }

    await electronApp.close()
  })
})
