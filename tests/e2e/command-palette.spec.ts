import { expect, test } from '@playwright/test'
import { dismissPermissionWizard, launchCluiApp } from './helpers/clui'

test('opens command palette with Ctrl+K and closes with Escape', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Command palette should not be visible initially
  await expect(page.getByTestId('command-palette')).toHaveCount(0)

  // Press Ctrl+K to open
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 5_000 })

  // Search input should be focused
  await expect(page.getByTestId('command-palette-search')).toBeVisible()

  // Press Escape to close
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('command-palette')).toHaveCount(0, { timeout: 5_000 })

  await electronApp.close()
})

test('searches and filters commands in the palette', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Open command palette
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 5_000 })

  // Type "theme" to filter
  await page.getByTestId('command-palette-search').fill('theme')

  // Should show theme-related commands and hide unrelated ones
  await expect(page.getByTestId('command-palette-item-theme-light')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('command-palette-item-theme-dark')).toBeVisible()
  await expect(page.getByTestId('command-palette-item-theme-system')).toBeVisible()

  // Non-theme commands should not be visible
  await expect(page.getByTestId('command-palette-item-new-tab')).toHaveCount(0)

  await electronApp.close()
})

test('Ctrl+T creates a new tab and Ctrl+W closes it', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Should start with 1 tab
  const initialTabs = await page.locator('[role="tab"]').count()

  // Press Ctrl+T to create a new tab
  await page.keyboard.press('Control+t')
  await expect(page.locator('[role="tab"]')).toHaveCount(initialTabs + 1, { timeout: 5_000 })

  // Press Ctrl+W to close the tab
  await page.keyboard.press('Control+w')
  await expect(page.locator('[role="tab"]')).toHaveCount(initialTabs, { timeout: 5_000 })

  await electronApp.close()
})
