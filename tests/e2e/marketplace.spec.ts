import { expect, test } from '@playwright/test'
import { dismissPermissionWizard, launchCluiApp } from './helpers/clui'

test('marketplace panel opens via command palette', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Marketplace should not be visible initially
  await expect(page.getByTestId('marketplace-panel')).toHaveCount(0)

  // Open command palette and select marketplace
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 5_000 })

  await page.getByTestId('command-palette-search').fill('marketplace')
  await expect(page.getByTestId('command-palette-item-marketplace')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('command-palette-item-marketplace').click()

  // Verify marketplace panel renders with expected content
  await expect(page.getByTestId('marketplace-panel')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Skills Marketplace')).toBeVisible()

  await electronApp.close()
})
