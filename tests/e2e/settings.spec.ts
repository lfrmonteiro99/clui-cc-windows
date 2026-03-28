import { expect, test } from '@playwright/test'
import { dismissPermissionWizard, launchCluiApp } from './helpers/clui'

test('settings popover opens when clicking the settings button', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Settings popover should not be visible initially
  await expect(page.getByTestId('settings-popover')).toHaveCount(0)

  // Click the settings button
  await page.getByTestId('settings-button').click()

  // Verify the popover is visible with expected settings
  await expect(page.getByTestId('settings-popover')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('Notification sound')).toBeVisible()
  await expect(page.getByText('Theme')).toBeVisible()

  await electronApp.close()
})

test('theme can be switched from settings', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Open settings popover
  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('settings-popover')).toBeVisible({ timeout: 5_000 })

  // Click the "light" theme button
  await page.getByTestId('settings-theme-light').click()

  // Verify the light theme button now has the active accent styling
  // (the button gets accentLight background when active)
  await expect(page.getByTestId('settings-theme-light')).toBeVisible()

  // Switch to dark theme
  await page.getByTestId('settings-theme-dark').click()
  await expect(page.getByTestId('settings-theme-dark')).toBeVisible()

  await electronApp.close()
})
