import { test, expect } from '@playwright/test'

const first = { bill_type: 'channel', bill_id: 'bill-a', bill_number: 'QD-TEST-A', partner_name: '测试九游公司', settlement_month: '2026-03', game_name: '仙帝神兵', bill_amount: 760.66, outstanding_amount: 760.66, score: 86, confidence_level: 'high', reasons: ['金额一致', '客户名称一致'] }
const second = { ...first, bill_id: 'bill-b', bill_number: 'QD-TEST-B', settlement_month: '2026-04', game_name: '帝国雄师', outstanding_amount: 800, score: 55, confidence_level: 'low', reasons: ['客户名称一致，账期需核实'] }
const suggestions = [
  { transaction_id: 'tx-a', trade_date: '2026-05-13', transaction_no: 'BANK-TEST', direction: 'collection', direction_label: '收入', amount: 760.66, counterparty_name: '九游 · 测试九游公司', summary: '结算款', confidence_level: 'high', top_score: 86, auto_ready: true, candidates: [first, second] },
  { transaction_id: 'tx-b', trade_date: '2026-05-15', direction: 'payment', direction_label: '支出', amount: 900, counterparty_name: '研发测试公司', confidence_level: 'low', candidates: [{ ...second, bill_type: 'rd', partner_name: '研发测试公司' }] },
  { transaction_id: 'tx-c', direction: 'collection', amount: 30, confidence_level: 'none', candidates: [] }
]
async function open(page) {
  const writes = []
  page.on('pageerror', error => { throw error })
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'GET') { writes.push({ path, body: route.request().postDataJSON() }); return route.fulfill({ json: {} }) }
    if (path === '/api/auth/me') return route.fulfill({ json: { role: 'admin', permissions: [] } })
    if (path === '/api/bank-auto-reconciliation') return route.fulfill({ json: { stats: {}, suggestions, recent_matches: [] } })
    return route.fulfill({ json: { items: [], total: 0, stats: {} } })
  })
  await page.goto('/tests/fixtures/bank-match.html')
  await expect(page.locator('.bank-match-row')).toHaveCount(3)
  return writes
}

test('candidate change updates month, amount, score, reasons and confirmation target', async ({ page }) => {
  const writes = await open(page)
  const row = page.locator('.bank-match-row').first()
  await expect(row).toContainText('金额一致')
  await expect(row).toContainText('高匹配 · 86分')
  await row.getByRole('combobox').selectOption('channel:bill-b')
  await expect(row.locator('.bank-match-meta').last()).toContainText('2026-04')
  await expect(row).toContainText('流水少 ¥39.34')
  await expect(row).toContainText('低匹配 · 55分')
  await row.getByRole('button', { name: '展开对照' }).click()
  await expect(page.locator('.bank-match-detail')).toContainText('客户名称一致，账期需核实')
  await page.getByRole('button', { name: 'QD-TEST-B · 查看账单' }).click()
  await expect(page.getByTestId('opened')).toHaveText('channel:bill-b')
  expect(writes).toEqual([])
  page.once('dialog', dialog => dialog.dismiss())
  await row.getByRole('button', { name: '人工确认' }).click()
  expect(writes).toEqual([])
  page.once('dialog', dialog => dialog.accept())
  await row.getByRole('button', { name: '人工确认' }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].path).toBe('/api/bank-auto-reconciliation/tx-a/confirm')
  expect(writes[0].body).toEqual({ bill_type: 'channel', bill_id: 'bill-b' })
})

test('payment and no-candidate rows remain distinct and tools do not cover actions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const writes = await open(page)
  const payment = page.locator('.bank-match-row').nth(1)
  await expect(payment).toContainText('账单未付')
  await expect(payment).toContainText('流水多 ¥100.00')
  await expect(page.locator('.bank-match-row').last().getByRole('button', { name: '人工确认' })).toBeDisabled()
  for (const selector of ['.bank-customer-launcher', '.rd-prepay-workbench-launcher']) {
    expect(await page.locator(selector).evaluate(el => getComputedStyle(el).position)).toBe('static')
  }
  expect(writes).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('bank-match-desktop.png'), fullPage: true })
})

test('mobile keeps table scrolling inside the card and candidates usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  const dimensions = await page.locator('.bank-match-table').evaluate(table => ({ page: document.documentElement.scrollWidth, viewport: innerWidth, table: table.scrollWidth, container: table.parentElement.clientWidth }))
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1)
  expect(dimensions.table).toBeGreaterThan(dimensions.container)
  await page.getByRole('combobox', { name: '选择账单 tx-a' }).selectOption('channel:bill-b')
  await expect(page.locator('.bank-match-row').first()).toContainText('流水少 ¥39.34')
})
