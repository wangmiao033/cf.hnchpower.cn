import { test, expect } from '@playwright/test'

async function getVoucherRecord(page) {
  const raw = await page.getByTestId('calculated-record').textContent()
  return JSON.parse(raw || '{}').items?.[0] || {}
}

test('voucher input stays on one game row and reuses original voucher handlers', async ({ page }) => {
  await page.goto('/tests/fixtures/channel-create-prefill.html?blank=1')
  // The fixture defaults to the simple bill mode, where the entire voucher
  // column is hidden. Exercise the voucher cell in the actual advanced-field
  // state without changing the application's simple/advanced display rules.
  await page.locator('main.core-bill-form-page--channel').evaluate(node => node.classList.add('has-advanced-data'))

  const rows = page.locator('.channel-line-items-table tbody tr')
  await expect(rows).toHaveCount(1)
  const cell = rows.first().locator('.channel-voucher-cell')
  const mode = cell.getByRole('combobox', {name: '第1行代金券口径'})
  const amount = cell.getByRole('spinbutton', {name: '第1行代金券金额'})

  await expect(mode).toHaveValue('discount')
  await expect(cell.locator('input[type="radio"]')).toHaveCount(0)
  await expect(amount).toBeVisible()
  await expect(mode).toBeVisible()
  const [amountBox, modeBox] = await Promise.all([amount.boundingBox(), mode.boundingBox()])
  expect(amountBox).not.toBeNull()
  expect(modeBox).not.toBeNull()
  expect(Math.abs(amountBox.y - modeBox.y)).toBeLessThan(8)

  // Normal entry requires only one amount; its persisted face-value field is unchanged.
  await amount.fill('648')
  await expect.poll(async () => (await getVoucherRecord(page)).voucherFaceValue).toBe(648)
  await expect.poll(async () => (await getVoucherRecord(page)).voucherDirectCost).toBeNull()

  // Switching mode must call the existing adapter; it is not a new formula.
  await mode.selectOption('direct')
  await expect(mode).toHaveValue('direct')
  await expect.poll(async () => (await getVoucherRecord(page)).voucherDirectCost).toBe(648)
  await expect.poll(async () => (await getVoucherRecord(page)).voucherFaceValue).toBeNull()

  // Dual vouchers remain two inputs inside the SAME game row, never a new card/row.
  await mode.selectOption('both')
  await expect(mode).toHaveValue('both')
  await expect(cell.getByRole('spinbutton', {name: '第1行折算券原始面额'})).toBeVisible()
  await expect(cell.getByRole('spinbutton', {name: '第1行直扣券实际金额'})).toBeVisible()
  await expect(rows).toHaveCount(1)
  await cell.getByRole('spinbutton', {name: '第1行折算券原始面额'}).fill('100')
  await expect.poll(async () => (await getVoucherRecord(page)).voucherFaceValue).toBe(100)
  await expect.poll(async () => (await getVoucherRecord(page)).voucherDirectCost).toBe(648)

  // Existing safety confirmation is preserved when changing a populated two-voucher row.
  page.once('dialog', dialog => dialog.dismiss())
  await mode.selectOption('discount')
  await expect.poll(async () => (await getVoucherRecord(page)).voucherDirectCost).toBe(648)
  await expect(mode).toHaveValue('both')

  page.once('dialog', dialog => dialog.accept())
  await mode.selectOption('discount')
  await expect.poll(async () => (await getVoucherRecord(page)).voucherDirectCost).toBeNull()
  await expect.poll(async () => (await getVoucherRecord(page)).voucherFaceValue).toBe(100)
  await expect(rows).toHaveCount(1)
})
