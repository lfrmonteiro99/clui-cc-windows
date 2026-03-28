import { expect, test } from '@playwright/test'
import { dismissPermissionWizard, launchCluiApp } from './helpers/clui'

test.describe('E2E-007: Sandbox', () => {
  test('sandbox mode toggle is available in settings', async ({}, testInfo) => {
    test.setTimeout(90_000)

    const { electronApp, page } = await launchCluiApp(testInfo)

    await dismissPermissionWizard(page)

    // Open settings popover
    const settingsBtn = page.getByTestId('settings-button')
    await expect(settingsBtn).toBeVisible({ timeout: 15_000 })
    await settingsBtn.click()

    // The sandbox toggle (Safe Mode) should be visible inside the settings popover
    const sandboxToggle = page.getByTestId('sandbox-toggle')
    await expect(sandboxToggle).toBeVisible({ timeout: 5_000 })

    // Verify it shows the expected label text
    await expect(sandboxToggle).toContainText('Safe Mode')

    // Verify the toggle is interactive (clickable)
    await sandboxToggle.click()

    // After clicking, the toggle should still be visible and have updated state
    await expect(sandboxToggle).toBeVisible()

    await electronApp.close()
  })
})
