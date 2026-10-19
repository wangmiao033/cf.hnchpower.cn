import { test, expect } from '@playwright/test'

test('channel bill keeps settlement adjustments and remarks hidden until explicitly needed', async ({ page }) => {
  await page.goto('/tests/fixtures/channel-create-prefill.html?blank=1')

  const adjustment = page.getByTestId('channel-optional-adjustment')
  const adjustmentToggle = adjustment.getByRole('button', { name: /特殊结算调整/ })
  const remarks = page.getByTestId('channel-optional-remarks')
  const notesToggle = remarks.getByRole('button', { name: /添加备注/ })

  await expect(adjustmentToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(adjustment.locator('input[type="number"]')).toHaveCount(0)
  await expect(notesToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(remarks.locator('textarea')).toHaveCount(0)
  await expect(page.locator('.channel-bill-meta-grid__remark')).toHaveCount(0)

  await notesToggle.click()
  const notesField = remarks.getByRole('textbox', { name: '备注 / 特殊说明' })
  await notesField.fill('12 月特殊结算确认，保留原始账单备注')
  await expect.poll(async () => {
    const raw = await page.getByTestId('calculated-record').textContent()
    return JSON.parse(raw || '{}').remark
  }).toBe('12 月特殊结算确认，保留原始账单备注')
  await remarks.getByRole('button', { name: /已填写/ }).click()
  await expect(remarks.locator('textarea')).toHaveCount(0)
  await expect(remarks.getByRole('button', { name: /已填写/ })).toHaveAttribute('aria-expanded', 'false')

  await adjustmentToggle.click()
  await expect(adjustmentToggle).toHaveAttribute('aria-expanded', 'true')
  await adjustment.getByRole('spinbutton', { name: /调整金额/ }).fill('-498.64')
  await adjustment.getByRole('textbox', { name: /调整原因/ }).fill('历史差额扣回')
  await expect.poll(async () => {
    const raw = await page.getByTestId('calculated-record').textContent()
    const state = JSON.parse(raw || '{}')
    return [Number(state.settlementAdjustmentAmount),state.settlementAdjustmentReason]
  }).toEqual([-498.64,'历史差额扣回'])
  await adjustmentToggle.click()
  await expect(adjustmentToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(adjustmentToggle).toContainText('已启用')
  await expect(adjustment.locator('input[type="number"]')).toHaveCount(0)
  const saved = JSON.parse(await page.getByTestId('calculated-record').textContent())
  expect(saved.remark).toBe('12 月特殊结算确认，保留原始账单备注')
  expect(Number(saved.settlementAdjustmentAmount)).toBe(-498.64)

  // Returning to the optional editor must restore the existing data.
  await adjustmentToggle.click()
  await expect(adjustment.getByRole('spinbutton', { name: /调整金额/ })).toHaveValue('-498.64')
  await expect(adjustment.getByRole('textbox', { name: /调整原因/ })).toHaveValue('历史差额扣回')
})
