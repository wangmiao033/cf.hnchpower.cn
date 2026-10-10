import { test, expect } from '@playwright/test'

const ledger = '.channel-flat-ledger'
const rows = `${ledger} tbody tr`
async function open(page) {
  const requests = []
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    requests.push(route.request().method() + ' ' + new URL(route.request().url()).pathname)
    if (new URL(route.request().url()).pathname === '/api/bill-lifecycle/archive') {
      return route.fulfill({ json: { archived_ids: ['archived'], eligible_ids: [], items: [] } })
    }
    if (new URL(route.request().url()).pathname === '/api/auth/me') {
      return route.fulfill({ json: { role: 'admin', permissions: [] } })
    }
    return route.abort()
  })
  page.on('pageerror', error => { throw error })
  await page.goto('/tests/fixtures/channel-detail.html')
  await expect(page.locator(rows)).toHaveCount(28)
  return requests
}

test('detail channel dropdown shares search state, clears selection and resets pagination', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const requests = await open(page)
  const select = page.getByLabel('筛选明细渠道')
  await expect(select.locator('option')).toHaveText(['全部渠道', '八门', '百分', '归档渠道'])
  await page.getByLabel('每页账单数量').selectOption('25')
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.getByLabel('选择当前页全部可操作账单').check()
  await select.selectOption('百分')
  await expect(page.getByLabel('搜索渠道')).toHaveValue('百分')
  await expect(page.locator(rows)).toHaveCount(14)
  await expect(page.locator(`${ledger} tbody input:checked`)).toHaveCount(0)
  await expect(page.locator(`${ledger} footer strong`)).toHaveText('1 / 1')
  await expect(page.locator(`${ledger} tbody`)).not.toContainText('八门')
  await select.selectOption('')
  await expect(page.getByLabel('搜索渠道')).toHaveValue('')
  await expect(page.locator(`${ledger} footer strong`)).toHaveText('1 / 2')

  await page.getByLabel('搜索渠道').fill('八')
  await page.getByLabel('搜索渠道').press('Enter')
  await expect(select).toHaveValue('八')
  await expect(select.locator('option:checked')).toHaveText('搜索：八')
  await expect(page.locator(rows)).toHaveCount(14)
  await select.selectOption('百分')
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await expect(select).toHaveValue('')
  await expect(page.getByLabel('搜索渠道')).toHaveValue('')
  expect(requests.sort()).toEqual(['GET /api/auth/me', 'GET /api/bill-lifecycle/archive'])
})

test('channel selection combines with game/month filters and keeps archive choices available', async ({ page }) => {
  await open(page)
  const select = page.getByLabel('筛选明细渠道')
  await select.selectOption('百分')
  await page.getByLabel('游戏名称', { exact: true }).fill('游戏甲')
  await page.getByLabel('起始月份', { exact: true }).fill('2026-09')
  await page.getByLabel('结束月份', { exact: true }).fill('2026-09')
  await expect(page.locator(rows)).toHaveCount(3)
  await expect(page.locator(`${ledger} tbody`)).not.toContainText('游戏乙')
  await expect(page.locator(`${ledger} tbody`)).not.toContainText('2026-08')
  await expect(select.locator('option')).toHaveCount(4)
  await page.getByRole('tab', { name: '按渠道汇总', exact: true }).click()
  await expect(page.locator('.channel-group-panel-title')).toContainText('1 个渠道 · 3 张账单')
  await page.getByRole('tab', { name: '账单明细', exact: true }).click()
  await expect(select).toHaveValue('百分')
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await select.selectOption('归档渠道')
  await expect(page.locator('.channel-flat-ledger__empty')).toBeVisible()
  await page.getByRole('button', { name: /归档账单/ }).click()
  await expect(page.locator(rows)).toHaveCount(1)
  await expect(page.locator(`${ledger} tbody`)).toContainText('归档渠道')
})

test('five detail filters stay on one desktop row and wrap within a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await open(page)
  const boxes = await page.locator('.channel-ledger-extra-filters label').evaluateAll(labels =>
    labels.map(label => ({ x: label.getBoundingClientRect().x, y: label.getBoundingClientRect().y })))
  expect(boxes).toHaveLength(5)
  expect(new Set(boxes.map(box => box.y)).size).toBe(1)
  expect(boxes[1].x).toBeGreaterThan(boxes[0].x)
  await page.setViewportSize({ width: 390, height: 844 })
  const bounds = await page.getByLabel('筛选明细渠道').boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  await page.getByLabel('筛选明细渠道').selectOption('八门')
  await expect(page.locator(rows)).toHaveCount(14)
})
