import { test, expect } from '@playwright/test'

const record = async page => JSON.parse(await page.getByTestId('calculated-record').textContent())
const line = async page => (await record(page)).items[0]

test.beforeEach(async ({ page }) => {
  // This fixture never contacts production. All API calls are stubbed locally.
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    if (route.request().method() !== 'GET' && !new URL(route.request().url()).pathname.includes('recommend')) return route.abort()
    return route.fulfill({ json: { items: [], lines: [], partner_rule_status: 'none', total: 0 } })
  })
})

test('existing Aiqu line stays pre-discount until preview is explicitly applied, preserving inputs', async ({ page }) => {
  await page.goto('/tests/fixtures/channel-revenue-basis.html')
  const selector = page.getByRole('combobox', { name: '第1行流水口径' })
  await expect(selector).toHaveValue('pre_discount')
  await expect.poll(async () => (await line(page)).effectiveFlow).toBe(100)
  await selector.selectOption('post_discount')
  const preview = page.getByRole('region', { name: '第1行流水口径变更预览' })
  await expect(preview).toContainText('¥100.00 → ¥1000.00')
  await expect(preview).toContainText('¥30.00 → ¥300.00')
  expect((await line(page)).revenueBasis).toBe('pre_discount')
  await page.getByRole('button', { name: '测试保存' }).click()
  await expect(page.getByTestId('form-error')).toContainText('仍在预览中')
  await expect(page.getByTestId('saved-count')).toHaveText('0')
  await page.getByRole('button', { name: '取消，保留原口径' }).click()
  await expect(preview).toHaveCount(0)
  expect((await line(page)).effectiveFlow).toBe(100)
  await selector.selectOption('post_discount')
  await page.getByRole('button', { name: '应用本行流水口径' }).click()
  await expect(selector).toHaveValue('post_discount')
  const changed = await line(page)
  expect(changed.flow).toBe(1000)
  expect(changed.discountFactor).toBe(0.1)
  expect(changed.effectiveFlow).toBe(1000)
  expect(changed.systemSettlementAmount).toBe(300)
  await expect(page.getByLabel('第1行游戏折扣')).toHaveValue('0.1')
  await expect(page.getByText('版本参考，不再乘流水')).toBeVisible()
})

test('face voucher needs separate deliberate review or direct-mode choice, never silent reinterpretation', async ({ page }) => {
  await page.goto('/tests/fixtures/channel-revenue-basis.html?face=1')
  await page.getByLabel('第1行流水口径').selectOption('post_discount')
  const apply = page.getByRole('button', { name: '应用本行流水口径' })
  await expect(apply).toBeDisabled()
  expect((await line(page)).voucherFaceValue).toBe(100)
  const faceReview = page.getByLabel('我确认现有折算券是原始面额，继续按游戏折扣换算，不改为直扣。')
  await faceReview.check()
  await expect(apply).toBeEnabled()
  // Changing the amount invalidates the old acknowledgement.
  await page.getByLabel('第1行代金券金额').fill('200')
  await expect(faceReview).not.toBeChecked()
  await expect(apply).toBeDisabled()
  await page.getByLabel('第1行代金券口径').selectOption('direct')
  await expect(apply).toBeEnabled()
  await apply.click()
  const changed = await line(page)
  expect(changed.flow).toBe(1000)
  expect(changed.discountFactor).toBe(0.1)
  expect(changed.voucherFaceValue).toBeNull()
  expect(changed.voucherDirectCost).toBe(200)
  expect(changed.billingAmount).toBe(800)
  expect(changed.systemSettlementAmount).toBe(240)
})

for (const protection of ['confirmed', 'received']) {
  test(`protects ${protection} source records from basis conversion`, async ({ page }) => {
    await page.goto(`/tests/fixtures/channel-revenue-basis.html?${protection}=1`)
    await expect(page.getByLabel('第1行流水口径')).toBeDisabled()
    expect((await line(page)).revenueBasis).toBe('pre_discount')
  })
}

test('does not mistake zero-receivable paid display for actual receipts', async ({ page }) => {
  await page.goto('/tests/fixtures/channel-revenue-basis.html?zeroPaid=1')
  await expect(page.getByLabel('第1行流水口径')).toBeEnabled()
})

test('keeps unrelated channel UI and calculation unchanged', async ({ page }) => {
  await page.goto('/tests/fixtures/channel-revenue-basis.html?other=1')
  await expect(page.getByLabel('第1行流水口径')).toHaveCount(0)
  await expect.poll(async () => (await line(page)).effectiveFlow).toBe(100)
  expect((await line(page)).revenueBasis).toBe('pre_discount')
})
