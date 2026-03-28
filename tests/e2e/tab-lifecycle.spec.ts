import { expect, test } from '@playwright/test'
import { dismissPermissionWizard, launchCluiApp } from './helpers/clui'

test('E2E-002a: create multiple tabs', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // App starts with 1 tab
  await expect(page.locator('[role="tab"]')).toHaveCount(1)

  // Click "+" to create a 2nd tab
  await page.getByTestId('tab-new-button').click()
  await expect(page.locator('[role="tab"]')).toHaveCount(2)

  await electronApp.close()
})

test('E2E-002b: switch between tabs', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Create a second tab
  await page.getByTestId('tab-new-button').click()
  await expect(page.locator('[role="tab"]')).toHaveCount(2)

  // Click tab 1 (first), verify it's active
  await page.locator('[role="tab"]').first().click()
  await expect(page.locator('[role="tab"]').first()).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[role="tab"]').last()).toHaveAttribute('aria-selected', 'false')

  // Click tab 2 (last), verify it's active
  await page.locator('[role="tab"]').last().click()
  await expect(page.locator('[role="tab"]').last()).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[role="tab"]').first()).toHaveAttribute('aria-selected', 'false')

  await electronApp.close()
})

test('E2E-002c: close middle tab', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Create 3 tabs total
  await page.getByTestId('tab-new-button').click()
  await page.getByTestId('tab-new-button').click()
  await expect(page.locator('[role="tab"]')).toHaveCount(3)

  // Close the middle tab (index 1) via its close button
  const middleTab = page.locator('[role="tab"]').nth(1)
  await middleTab.hover()
  await middleTab.locator('button[aria-label="Close tab"]').click()

  // Verify 2 tabs remain
  await expect(page.locator('[role="tab"]')).toHaveCount(2)

  await electronApp.close()
})

test('E2E-002d: last tab close button hidden when only 1 tab', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Start with 1 tab — close button should not be visible
  await expect(page.locator('[role="tab"]')).toHaveCount(1)
  const singleTab = page.locator('[role="tab"]').first()
  await singleTab.hover()
  await expect(singleTab.locator('button[aria-label="Close tab"]')).toHaveCount(0)

  // Add a second tab — close buttons should now appear
  await page.getByTestId('tab-new-button').click()
  await expect(page.locator('[role="tab"]')).toHaveCount(2)

  // Close one tab to get back to 1
  const lastTab = page.locator('[role="tab"]').last()
  await lastTab.hover()
  await lastTab.locator('button[aria-label="Close tab"]').click()
  await expect(page.locator('[role="tab"]')).toHaveCount(1)

  // Close button should be hidden again on the remaining tab
  const remaining = page.locator('[role="tab"]').first()
  await remaining.hover()
  await expect(remaining.locator('button[aria-label="Close tab"]')).toHaveCount(0)

  await electronApp.close()
})

test('E2E-002e: tab rename via double-click', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Double-click the tab title to enter edit mode
  const tabTitle = page.locator('[role="tab"]').first().getByTestId('tab-title')
  await tabTitle.dblclick()

  // Type new name
  const renameInput = page.locator('[role="tab"]').first().getByTestId('tab-rename-input')
  await expect(renameInput).toBeVisible()
  await renameInput.fill('My Custom Tab')
  await renameInput.press('Enter')

  // Verify name is shown
  await expect(tabTitle).toHaveText('My Custom Tab')

  await electronApp.close()
})
