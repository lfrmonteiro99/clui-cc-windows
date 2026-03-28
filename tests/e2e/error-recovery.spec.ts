import { expect, test } from '@playwright/test'
import { dismissPermissionWizard, launchCluiApp } from './helpers/clui'

test('empty input does nothing when send is clicked', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)

  await dismissPermissionWizard(page)

  // Ensure the input is empty
  const input = page.getByTestId('composer-input')
  await expect(input).toBeVisible()
  await input.fill('')

  // Click send with empty input
  await page.getByTestId('composer-send').click()

  // Wait a moment to ensure nothing happens
  await page.waitForTimeout(1000)

  // Verify no conversation messages appeared (no user message, no assistant message)
  await expect(page.getByTestId('message-user')).toHaveCount(0)
  await expect(page.getByTestId('message-assistant')).toHaveCount(0)

  // The input should still be empty and focused / available
  await expect(input).toBeVisible()

  await electronApp.close()
})

test('very long prompt shows character count and sends successfully', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)

  await dismissPermissionWizard(page)

  // Generate a 10,000 character prompt
  const longPrompt = 'A'.repeat(10_000)

  const input = page.getByTestId('composer-input')
  await expect(input).toBeVisible()

  // Fill the long prompt
  await input.fill(longPrompt)

  // Verify character count indicator is visible (threshold is 500 chars)
  await expect(page.getByTestId('char-count')).toBeVisible()

  // Verify the character count shows the correct number
  await expect(page.getByTestId('char-count')).toHaveText('10,000')

  // Send the prompt
  await page.getByTestId('composer-send').click()

  // Verify the response arrives (fake-claude echoes the prompt)
  await expect(
    page.getByTestId('conversation-view').getByText('Fake response to:'),
  ).toBeVisible({ timeout: 30_000 })

  await electronApp.close()
})

test('rapid tab creation does not crash', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)

  await dismissPermissionWizard(page)

  // Start with 1 default tab
  await expect(page.locator('[role="tab"]')).toHaveCount(1)

  // Create 8 tabs rapidly
  for (let i = 0; i < 8; i++) {
    await page.getByTestId('tab-new-button').click()
  }

  // Wait for all tabs to render
  await expect(page.locator('[role="tab"]')).toHaveCount(9, { timeout: 15_000 })

  // Verify each tab is visible and the app did not crash
  const tabs = page.locator('[role="tab"]')
  const count = await tabs.count()
  expect(count).toBe(9)

  // Click each tab to verify they are functional
  for (let i = 0; i < count; i++) {
    await tabs.nth(i).click()
    await page.waitForTimeout(100)
  }

  // App should still be responsive - verify we can type in the input
  await expect(page.getByTestId('composer-input')).toBeVisible()

  await electronApp.close()
})
