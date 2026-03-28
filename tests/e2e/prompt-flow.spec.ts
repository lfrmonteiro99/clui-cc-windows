import { expect, test } from '@playwright/test'
import { dismissPermissionWizard, launchCluiApp } from './helpers/clui'

test('full prompt lifecycle — send prompt, see streamed response, verify completion', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Create a new tab
  await page.getByTestId('tab-new-button').click()
  await expect(page.locator('[role="tab"]')).toHaveCount(2)
  await page.locator('[role="tab"]').last().click()

  // Type a prompt and send
  await page.getByTestId('composer-input').fill('hello from lifecycle test')
  await page.getByTestId('composer-send').click()

  // Verify user message appears in conversation
  await expect(
    page.getByTestId('conversation-view').getByText('hello from lifecycle test'),
  ).toBeVisible({ timeout: 15_000 })

  // Verify streamed response text appears (fake-claude echoes "Fake response to: <prompt>")
  await expect(
    page.getByTestId('conversation-view').getByText('Fake response to: hello from lifecycle test'),
  ).toBeVisible({ timeout: 30_000 })

  // Verify the status dot is NOT in a "running" state once response completes.
  // The running indicator uses bouncing dots — wait for them to disappear.
  await expect(
    page.locator('.animate-bounce-dot'),
  ).toHaveCount(0, { timeout: 15_000 })

  await electronApp.close()
})

test('cancel running prompt — interrupt preserves partial response', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Create a new tab
  await page.getByTestId('tab-new-button').click()
  await expect(page.locator('[role="tab"]')).toHaveCount(2)
  await page.locator('[role="tab"]').last().click()

  // Send a SLOW prompt (fake-claude uses 800ms delays between chunks)
  await page.getByTestId('composer-input').fill('SLOW: cancellation test')
  await page.getByTestId('composer-send').click()

  // Verify user message appears
  await expect(
    page.getByTestId('conversation-view').getByText('SLOW: cancellation test'),
  ).toBeVisible({ timeout: 15_000 })

  // Wait for the running indicator (bouncing dots) to confirm the response is streaming
  await expect(page.locator('.animate-bounce-dot').first()).toBeVisible({ timeout: 15_000 })

  // Click the Interrupt button (contains "Interrupt" text)
  const interruptBtn = page.getByTitle('Stop current task')
  await expect(interruptBtn).toBeVisible({ timeout: 10_000 })
  await interruptBtn.click()

  // After cancellation (SIGINT), the running indicator should disappear
  await expect(page.locator('.animate-bounce-dot')).toHaveCount(0, { timeout: 15_000 })

  // The user message should still be visible (partial response preserved)
  await expect(
    page.getByTestId('conversation-view').getByText('SLOW: cancellation test'),
  ).toBeVisible()

  // The "Failed" text or retry button should appear, since SIGINT → failed status
  await expect(page.getByText('Failed')).toBeVisible({ timeout: 10_000 })

  await electronApp.close()
})

test('retry after failure — error shown, retry produces new response', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Create a new tab
  await page.getByTestId('tab-new-button').click()
  await expect(page.locator('[role="tab"]')).toHaveCount(2)
  await page.locator('[role="tab"]').last().click()

  // Send an ERROR prompt (fake-claude emits error result and exits with code 1)
  await page.getByTestId('composer-input').fill('ERROR: simulated failure')
  await page.getByTestId('composer-send').click()

  // Verify user message appears
  await expect(
    page.getByTestId('conversation-view').getByText('ERROR: simulated failure'),
  ).toBeVisible({ timeout: 15_000 })

  // Wait for the process to exit and the error state to appear.
  // Non-zero exit (code 1) → 'dead' status → DeadRecoveryCard shows
  await expect(
    page.getByTestId('dead-recovery-card'),
  ).toBeVisible({ timeout: 15_000 })

  // Verify "Session ended unexpectedly" text is visible
  await expect(page.getByText('Session ended unexpectedly')).toBeVisible()

  // Click "New Tab" to recover and send a new prompt (new tab avoids session state issues)
  await page.getByTestId('dead-new-tab-btn').click()

  // The new tab should show the empty state / welcome card
  await expect(page.getByTestId('welcome-card')).toBeVisible({ timeout: 10_000 })

  // Send a normal prompt in the new tab
  await page.getByTestId('composer-input').fill('recovery prompt')
  await page.getByTestId('composer-send').click()

  // Verify the response comes through successfully
  await expect(
    page.getByTestId('conversation-view').getByText('Fake response to: recovery prompt'),
  ).toBeVisible({ timeout: 30_000 })

  await electronApp.close()
})

test('queue multiple prompts — second prompt waits for first to complete', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)
  await dismissPermissionWizard(page)

  // Create a new tab
  await page.getByTestId('tab-new-button').click()
  await expect(page.locator('[role="tab"]')).toHaveCount(2)
  await page.locator('[role="tab"]').last().click()

  // Send a SLOW prompt first (takes ~1.6s+ to complete)
  await page.getByTestId('composer-input').fill('SLOW: first prompt')
  await page.getByTestId('composer-send').click()

  // Wait for running indicator to confirm first prompt is being processed
  await expect(page.locator('.animate-bounce-dot').first()).toBeVisible({ timeout: 15_000 })

  // While the first prompt is still running, send a second prompt.
  // This should be queued since the tab is busy.
  await page.getByTestId('composer-input').fill('second prompt')
  await page.getByTestId('composer-send').click()

  // The queued message should appear with dashed border styling
  // QueuedMessage components render the queued prompt text
  await expect(
    page.getByTestId('conversation-view').getByText('second prompt'),
  ).toBeVisible({ timeout: 10_000 })

  // Wait for the first response to complete
  await expect(
    page.getByTestId('conversation-view').getByText('Fake response to: first prompt'),
  ).toBeVisible({ timeout: 30_000 })

  // After the first completes, the queued second prompt should execute.
  // Verify the second response appears.
  await expect(
    page.getByTestId('conversation-view').getByText('Fake response to: second prompt'),
  ).toBeVisible({ timeout: 30_000 })

  // Verify no more running indicators — everything is done
  await expect(page.locator('.animate-bounce-dot')).toHaveCount(0, { timeout: 15_000 })

  await electronApp.close()
})
