import { expect, test } from '@playwright/test'
import { dismissPermissionWizard, launchCluiApp } from './helpers/clui'

test('approve a permission request and verify tool execution continues', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo, { withPermissions: true })

  await dismissPermissionWizard(page)

  // Send a prompt that triggers a tool call (the permissions fixture emits a permission_request)
  await page.getByTestId('composer-input').fill('run echo hello')
  await page.getByTestId('composer-send').click()

  // Verify the permission card appears with "Permission Required" header
  const conversationView = page.getByTestId('conversation-view')
  await expect(conversationView.getByText('Permission Required')).toBeVisible({ timeout: 30_000 })

  // Click "Allow" to approve
  await conversationView.getByRole('button', { name: 'Allow' }).click()

  // Verify the tool execution completes — the fake fixture responds with "Executed: ..."
  await expect(conversationView.getByText('Executed: run echo hello')).toBeVisible({ timeout: 30_000 })

  await electronApp.close()
})

test('deny a permission request and verify denial is handled', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo, { withPermissions: true })

  await dismissPermissionWizard(page)

  // Send a prompt that triggers a tool call
  await page.getByTestId('composer-input').fill('run ls')
  await page.getByTestId('composer-send').click()

  // Wait for the permission card
  const conversationView = page.getByTestId('conversation-view')
  await expect(conversationView.getByText('Permission Required')).toBeVisible({ timeout: 30_000 })

  // Click "Deny"
  await conversationView.getByRole('button', { name: 'Deny' }).click()

  // Verify permission card disappears (queue is cleared on task_complete)
  await expect(conversationView.getByText('Permission Required')).toHaveCount(0, { timeout: 15_000 })

  await electronApp.close()
})

test('permission card shows tool name and input preview', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo, { withPermissions: true })

  await dismissPermissionWizard(page)

  // Send a prompt to trigger the Bash tool permission
  await page.getByTestId('composer-input').fill('trigger bash tool')
  await page.getByTestId('composer-send').click()

  // Wait for the permission card
  const conversationView = page.getByTestId('conversation-view')
  await expect(conversationView.getByText('Permission Required')).toBeVisible({ timeout: 30_000 })

  // Verify the tool name "Bash" is visible
  await expect(conversationView.getByText('Bash')).toBeVisible()

  // Verify input preview is visible (the fixture sends { command: 'echo hello from e2e' })
  const inputPreview = page.getByTestId('permission-input-preview')
  await expect(inputPreview).toBeVisible()
  await expect(inputPreview).toContainText('echo hello from e2e')

  // Clean up — allow so the process terminates
  await conversationView.getByRole('button', { name: 'Allow' }).click()
  await electronApp.close()
})

test('auto-mode confirmation dialog appears and changes mode', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)

  await dismissPermissionWizard(page)

  // Click the permission mode picker in the status bar
  await page.getByTestId('permission-mode-picker').click()

  // Click the "Auto" option in the popover — use the button that contains text "Auto"
  // The popover has two buttons: "Ask" and "Auto"
  const autoButton = page.locator('[data-clui-ui] button', { hasText: 'Auto' })
  await autoButton.click()

  // Verify the confirmation dialog appears
  await expect(page.getByTestId('auto-confirm-dialog')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('Enable Auto Mode?')).toBeVisible()

  // Confirm auto mode
  await page.getByTestId('auto-confirm-yes').click()

  // Verify the mode picker now shows "Auto"
  await expect(page.getByTestId('permission-mode-picker')).toContainText('Auto')

  await electronApp.close()
})

test('permission mode is reflected in status bar', async ({}, testInfo) => {
  test.setTimeout(90_000)

  const { electronApp, page } = await launchCluiApp(testInfo)

  await dismissPermissionWizard(page)

  // By default the mode should be "Ask"
  await expect(page.getByTestId('permission-mode-picker')).toContainText('Ask')

  // Switch to auto mode
  await page.getByTestId('permission-mode-picker').click()
  const autoButton = page.locator('[data-clui-ui] button', { hasText: 'Auto' })
  await autoButton.click()
  await page.getByTestId('auto-confirm-yes').click()

  // Verify status bar shows "Auto"
  const statusBar = page.getByTestId('status-bar')
  await expect(statusBar.getByTestId('permission-mode-picker')).toContainText('Auto')

  await electronApp.close()
})
