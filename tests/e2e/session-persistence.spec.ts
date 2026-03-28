import { expect, test } from '@playwright/test'
import { dismissPermissionWizard, launchCluiApp } from './helpers/clui'

test('session appears in history after conversation', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)

  await dismissPermissionWizard(page)

  // Send a prompt and wait for the response
  await page.getByTestId('composer-input').fill('hello from session persistence test')
  await page.getByTestId('composer-send').click()

  await expect(
    page.getByTestId('conversation-view').getByText('Fake response to: hello from session persistence test'),
  ).toBeVisible({ timeout: 30_000 })

  // Open history picker
  await page.getByTestId('history-picker-button').click()

  // Verify the history popover is visible
  await expect(page.getByTestId('history-picker-popover')).toBeVisible({ timeout: 10_000 })

  // Verify at least one session item appears (either pinned or recent)
  const sessionItems = page.getByTestId('history-session-item')
  const pinnedItems = page.getByTestId('history-session-pinned')
  const totalCount = await sessionItems.count() + await pinnedItems.count()
  expect(totalCount).toBeGreaterThanOrEqual(1)

  await electronApp.close()
})

test('resume crashed session shows recovery card', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)

  await dismissPermissionWizard(page)

  // Send a prompt to establish a session
  await page.getByTestId('composer-input').fill('hello before crash')
  await page.getByTestId('composer-send').click()

  await expect(
    page.getByTestId('conversation-view').getByText('Fake response to: hello before crash'),
  ).toBeVisible({ timeout: 30_000 })

  // The fake-claude process exits after responding, which triggers session_dead.
  // Wait for the dead recovery card to appear.
  await expect(page.getByTestId('dead-recovery-card')).toBeVisible({ timeout: 15_000 })

  // Verify the Resume button is present
  await expect(page.getByTestId('dead-resume-btn')).toBeVisible()

  // Click Resume
  await page.getByTestId('dead-resume-btn').click()

  // After clicking resume, the recovery card should disappear (a new session starts)
  // The conversation view should still be visible
  await expect(page.getByTestId('conversation-view')).toBeVisible({ timeout: 15_000 })

  await electronApp.close()
})

test('pin and unpin session in history', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)

  await dismissPermissionWizard(page)

  // Send a prompt to create a session
  await page.getByTestId('composer-input').fill('pin test session')
  await page.getByTestId('composer-send').click()

  await expect(
    page.getByTestId('conversation-view').getByText('Fake response to: pin test session'),
  ).toBeVisible({ timeout: 30_000 })

  // Open history picker
  await page.getByTestId('history-picker-button').click()
  await expect(page.getByTestId('history-picker-popover')).toBeVisible({ timeout: 10_000 })

  // Wait for sessions to load (at least one recent session)
  await expect(page.getByTestId('history-session-item').first()).toBeVisible({ timeout: 10_000 })

  // Pin the first session
  await page.getByTestId('history-pin-btn').first().click()

  // After pinning, the session should appear in the pinned section
  await expect(page.getByTestId('history-session-pinned').first()).toBeVisible({ timeout: 10_000 })

  // Unpin it
  await page.getByTestId('history-unpin-btn').first().click()

  // After unpinning, it should no longer be in the pinned section
  await expect(page.getByTestId('history-session-pinned')).toHaveCount(0, { timeout: 10_000 })

  // It should be back in the recent section
  await expect(page.getByTestId('history-session-item').first()).toBeVisible({ timeout: 10_000 })

  await electronApp.close()
})
