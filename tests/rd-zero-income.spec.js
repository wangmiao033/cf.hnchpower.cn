import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:3100/api/**', route => route.fulfill({ json: { items: [], total: 0 } }))
})

test('mixed positive and explicit zero details save, reopen, export and resave without increasing totals or row count', async ({ page }) => {
  await page.goto('/tests/fixtures/rd-zero-income.html')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('零收入请填 0')
  await expect(page.getByTestId('save-count')).toHaveText('0')
  for (const index of [4, 5]) await page.getByLabel(`第 ${index} 行后台流水`, { exact: true }).fill('0')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByTestId('save-count')).toHaveText('1')
  const saved = JSON.parse(await page.getByTestId('saved').textContent())
  expect(saved.items).toHaveLength(5)
  expect(saved.settlementAmount).toBe('1234.56')
  expect(saved.status).toBe('pending')
  expect(saved.paymentStatus).toBe('未付款')
  await expect(page.getByTestId('export').locator('tr')).toHaveCount(5)
  await expect(page.getByTestId('export').locator('tr').nth(4)).toHaveText('合成游戏50.000.00')
  await expect(page.locator('.rd-progress-panel')).toContainText('合成游戏4、合成游戏5')
  await expect(page.locator('.rd-progress-panel')).not.toContainText('缺少流水')
  await page.getByRole('button', { name: '重新打开', exact: true }).click()
  await expect(page.getByLabel('第 5 行后台流水', { exact: true })).toHaveValue('0')
  for (let count = 2; count <= 3; count++) {
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByTestId('save-count')).toHaveText(String(count))
    expect(JSON.parse(await page.getByTestId('saved').textContent())).toMatchObject({ settlementAmount: '1234.56', status: 'pending' })
    expect(JSON.parse(await page.getByTestId('saved').textContent()).items).toHaveLength(5)
  }
})

test('zero-only details stay pending; blank, negative and restored blank drafts cannot be saved as zero', async ({ page }) => {
  await page.goto('/tests/fixtures/rd-zero-income.html?zeroOnly')
  await page.getByLabel('第 1 行后台流水', { exact: true }).fill('0')
  await page.getByRole('button', { name: '保存本机草稿', exact: true }).click()
  await page.reload()
  await expect(page.getByLabel('第 1 行后台流水', { exact: true })).toHaveValue('0')
  await expect(page.getByLabel('第 2 行后台流水', { exact: true })).toHaveValue('')
  for (const invalid of ['', '-1']) {
    await page.getByLabel('第 2 行后台流水', { exact: true }).fill(invalid)
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('非负数字')
    await expect(page.getByTestId('save-count')).toHaveText('0')
  }
  await page.getByLabel('第 2 行后台流水', { exact: true }).fill('0')
  await page.getByTitle('新增一行并继承当前月份', { exact: true }).first().click()
  await expect(page.getByLabel('第 3 行后台流水', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByTestId('save-count')).toHaveText('1')
  const saved = JSON.parse(await page.getByTestId('saved').textContent())
  expect(saved.items).toHaveLength(2)
  expect(saved.settlementAmount).toBe('0.00')
  expect(saved.status).toBe('pending')
  expect(saved.paymentStatus).toBe('未付款')
  await expect(page.locator('.rd-progress-panel')).not.toContainText('缺少流水')
})
