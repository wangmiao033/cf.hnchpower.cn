import { test, expect } from '@playwright/test'

test('an edit draft is not erased or replayed over a server-confirmed bill', async ({ page }) => {
  await page.goto('/tests/fixtures/bill-save-revision.html')
  await page.getByRole('button', { name: 'edit-draft' }).click()
  await expect(page.getByTestId('draft-status')).toContainText('草稿已自动保存', { timeout: 5000 })
  let existing = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.includes('channel') && key.includes('REV-1'))?.[1])
  expect(existing).toContain('99')
  expect(existing).toContain('v1')
  await page.getByRole('button', { name: 'server-confirms' }).click()
  await expect(page.getByTestId('server-status')).toHaveText('confirmed')
  await expect(page.getByTestId('draft-status')).toContainText('旧草稿已保留')
  await page.waitForTimeout(1100)
  const latest = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.includes('channel') && key.includes('REV-1'))?.[1])
  expect(latest).toBe(existing)
  expect(latest).not.toContain('"baseVersion":"v2"')
  // The old amount was not written to the new server record by background autosave.
  await expect(page.getByTestId('server-status')).toHaveText('confirmed')
  await page.getByRole('button', { name: 'discard-on-purpose' }).click()
  await expect(page.getByTestId('draft-status')).not.toContainText('旧草稿已保留')
})
