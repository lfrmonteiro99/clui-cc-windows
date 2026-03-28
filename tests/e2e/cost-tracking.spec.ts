import { expect, test } from '@playwright/test'
import { dismissPermissionWizard, launchCluiApp } from './helpers/clui'

test('cost dashboard opens via settings popover', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Cost dashboard should not be visible initially
  await expect(page.getByTestId('cost-dashboard')).toHaveCount(0)

  // Open settings popover
  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('settings-popover')).toBeVisible({ timeout: 5_000 })

  // Click "Usage" button to open cost dashboard
  await page.getByText('Usage').click()

  // Verify cost dashboard renders with expected content
  await expect(page.getByTestId('cost-dashboard')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Usage Dashboard')).toBeVisible()

  await electronApp.close()
})
