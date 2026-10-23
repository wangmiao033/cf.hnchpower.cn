import { test, expect } from '@playwright/test'
import { monthlyBills, toApiBill } from './fixtures/channel-monthly-data.js'

const summary = '[data-stat="receivable"]'
const amount = `${summary} strong`
const rows = '.channel-flat-ledger tbody tr'
const deferred = () => { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }

async function setup(page, options = {}) {
  const requests = []
  const bills = options.bills || monthlyBills()
  const filler = Array.from({ length: 500 }, (_, i) => ({ ...bills[0], id: `old-${i}`,
    settlementMonth: '2025-01', settlementAmount: 1, items: [{ settlementCycle: '2025-01', settlementAmount: 1 }] }))
  // Put the six archived bills on the second API page.
  const apiRows = [...filler, ...bills].map(toApiBill)
  await page.addInitScript(() => {
    localStorage.setItem('cf:channel-ledger-filters:v1:monthly-test', JSON.stringify({ month: '2026-07' }))
  })
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request()
    const url = new URL(request.url())
    requests.push(`${request.method()} ${url.pathname}`)
    if (request.method() !== 'GET') return route.abort()
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { id: 'monthly-test', role: 'admin', permissions: [] } })
    if (url.pathname === '/api/channel-records') {
      const offset = Number(url.searchParams.get('offset'))
      if (offset) {
        if (options.secondPage) await options.secondPage.promise
        if (options.failPage) return route.fulfill({ status: 503, json: { detail: 'synthetic page failure' } })
      }
      return route.fulfill({ json: { items: apiRows.slice(offset, offset + 500), total: apiRows.length } })
    }
    if (url.pathname === '/api/reconciliation-records') return route.fulfill({ json: { items: [], total: 0 } })
    if (url.pathname === '/api/bill-lifecycle/archive') {
      if (options.archive) await options.archive.promise
      if (options.failArchive) return route.fulfill({ status: 503, json: { detail: 'synthetic archive failure' } })
      return route.fulfill({ json: { archived_ids: bills.slice(39).map(row => row.id), eligible_ids: [], items: [] } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/tests/fixtures/channel-monthly.html')
  return { requests, errors }
}

test('July stays 60,950.09 across normal/archive tabs, pagination and grouped view', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const { requests, errors } = await setup(page)
  await expect(page.locator(rows)).toHaveCount(39)
  await expect(page.locator(amount)).toHaveText('¥ 60,950.09')
  await expect(page.locator(summary)).toContainText('含归档，按结算月份统计')
  await expect(page.locator('.core-recon-stats')).toContainText('列表未收（整单）')
  await page.getByLabel('每页账单数量').selectOption('25')
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.locator(rows)).toHaveCount(14)
  await expect(page.locator(amount)).toHaveText('¥ 60,950.09')
  await page.getByRole('button', { name: /归档账单/ }).click()
  await expect(page.locator(rows)).toHaveCount(6)
  await expect(page.locator(amount)).toHaveText('¥ 60,950.09')
  await page.screenshot({ path: testInfo.outputPath('july-archived-desktop.png'), fullPage: true })
  await page.getByRole('tab', { name: '按渠道汇总', exact: true }).click()
  await expect(page.locator(amount)).toHaveText('¥ 60,950.09')
  await page.getByRole('tab', { name: '账单明细', exact: true }).click()
  await page.getByLabel('账单快捷筛选').getByRole('button', { name: /^全部 39/ }).click()
  await expect(page.locator(rows)).toHaveCount(25)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('july-normal-mobile.png'), fullPage: true })
  const card = await page.locator(summary).boundingBox()
  const value = await page.locator(amount).boundingBox()
  expect(value.x).toBeGreaterThanOrEqual(card.x)
  expect(value.x + value.width).toBeLessThanOrEqual(390)
  expect(requests.filter(value => !value.startsWith('GET '))).toEqual([])
  expect(requests.filter(value => value === 'GET /api/channel-records')).toHaveLength(2)
  expect(errors).toEqual([])
})

test('partner/channel/review filters and consecutive month changes use actual monthly amounts', async ({ page }) => {
  await setup(page)
  await expect(page.locator(amount)).toHaveText('¥ 60,950.09')
  await page.getByLabel('搜索渠道账单').fill('跨月甲测试合作方')
  await expect(page.locator(amount)).toHaveText('¥ 10,000.00')
  await page.getByLabel('筛选明细结算月份').selectOption('2026-08')
  await expect(page.locator(amount)).toHaveText('¥ 508.91')
  await page.getByLabel('筛选明细结算月份').selectOption('2026-07')
  await expect(page.locator(amount)).toHaveText('¥ 10,000.00')
  await expect(page.locator('.core-recon-stats')).toContainText('1,000.00') // whole-bill receipts
  await page.getByLabel('搜索渠道账单').fill('')
  await page.getByLabel('筛选明细渠道').selectOption('跨月乙')
  await expect(page.locator(amount)).toHaveText('¥ 4,073.58')
  await page.getByRole('button', { name: /^未核对/ }).click()
  await expect(page.locator(amount)).toHaveText('¥ 0.00')
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await expect(page.locator(amount)).toHaveText('¥ 62,331.92')
  await expect(page.locator(summary)).toContainText('含归档，全部账单整单合计')
  await page.getByRole('button', { name: '更多筛选', exact: true }).click()
  await page.getByLabel('起始月份', { exact: true }).fill('2026-06')
  await page.getByLabel('结束月份', { exact: true }).fill('2026-07')
  await expect(page.locator(amount)).toHaveText('¥ 61,323.01')
})

test('does not flash zero, a first page subtotal or archive-dependent totals while loading', async ({ page }) => {
  const secondPage = deferred()
  const archive = deferred()
  await setup(page, { secondPage, archive })
  await expect(page.locator(amount)).toHaveText('加载中…')
  await expect(page.locator(summary)).toHaveAttribute('aria-busy', 'true')
  secondPage.release()
  await expect(page.locator(amount)).toHaveText('¥ 60,950.09')
  await page.getByRole('button', { name: /归档账单/ }).click()
  await expect(page.locator(amount)).toHaveText('¥ 60,950.09')
  archive.release()
  await expect(page.locator(rows)).toHaveCount(6)
  await expect(page.locator(amount)).toHaveText('¥ 60,950.09')
})

test('failed later page hides the total; failed archive lookup cannot alter the monthly total', async ({ page }) => {
  await setup(page, { failPage: true })
  await expect(page.locator(amount)).toHaveText('暂不可用')
  await expect(page.locator(summary)).toContainText('完整账单读取失败')
})

test('archive lookup failure still includes every saved bill once', async ({ page }) => {
  await setup(page, { failArchive: true })
  await expect(page.locator(amount)).toHaveText('¥ 60,950.09')
  await page.getByRole('button', { name: /归档账单/ }).click()
  await expect(page.locator(amount)).toHaveText('¥ 60,950.09')
})

test('missing months and incomplete breakdowns are explicitly marked as known amounts', async ({ page }) => {
  const bills = [
    { ...monthlyBills()[0], id: 'unknown', settlementMonth: '', items: [] },
    { ...monthlyBills()[0], id: 'incomplete', items: [
      { settlementCycle: '2026-07', settlementAmount: null },
      { settlementCycle: '2026-08', settlementAmount: 2 }
    ] }
  ]
  await setup(page, { bills })
  await expect(page.locator(amount)).toHaveText('¥ 0.00')
  await expect(page.locator(summary)).toContainText('渠道应收（已知）')
  await expect(page.locator('.channel-summary-scope')).toContainText('1 张账单存在无有效月份')
  await expect(page.locator('.channel-summary-scope')).toContainText('1 张账单缺少所选账期的分月金额')
})
