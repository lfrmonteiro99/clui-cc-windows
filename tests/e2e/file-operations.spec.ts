import { expect, test } from '@playwright/test'
import { dismissPermissionWizard, launchCluiApp } from './helpers/clui'

test.describe('E2E-005: File attachment', () => {
  test('directory picker is visible in empty state', async ({}, testInfo) => {
    test.setTimeout(90_000)

    const { electronApp, page } = await launchCluiApp(testInfo)

    await dismissPermissionWizard(page)

    // The directory picker should be visible in the initial empty conversation state
    await expect(page.getByTestId('directory-picker')).toBeVisible({ timeout: 15_000 })

    await electronApp.close()
  })

  test('attach button exists and is clickable', async ({}, testInfo) => {
    test.setTimeout(90_000)

    const { electronApp, page } = await launchCluiApp(testInfo)

    await dismissPermissionWizard(page)

    // The attach button should be present in the InputBar area
    const attachButton = page.getByTestId('attach-button')
    await expect(attachButton).toBeVisible({ timeout: 15_000 })

    // Verify the button is enabled and clickable (not disabled)
    await expect(attachButton).toBeEnabled()

    // Click should not throw — the native dialog will be dismissed automatically in CI
    // We just verify the button responds to interaction without error
    await attachButton.click()

    // The app should still be functional after clicking attach
    await expect(page.getByTestId('app-root')).toBeVisible()

    await electronApp.close()
  })
})
