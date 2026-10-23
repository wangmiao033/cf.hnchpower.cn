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

test('one shared channel dropdown clears selection and resets pagination', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const requests = await open(page)
  const select = page.getByLabel('筛选明细渠道')
  await expect(select.locator('option')).toHaveText(['全部渠道', '八门', '百分', '归档渠道'])
  await page.getByLabel('每页账单数量').selectOption('25')
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.getByLabel('选择当前页全部可操作账单').check()
  await select.selectOption('百分')
  await expect(page.getByLabel('筛选明细渠道')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '清除渠道筛选' })).toContainText('百分')
  await expect(page.locator(rows)).toHaveCount(14)
  await expect(page.locator(`${ledger} tbody input:checked`)).toHaveCount(0)
  await expect(page.locator(`${ledger} footer strong`)).toHaveText('1 / 1')
  await expect(page.locator(`${ledger} tbody`)).not.toContainText('八门')
  await select.selectOption('')
  await expect(page.getByRole('button', { name: '清除渠道筛选' })).toHaveCount(0)
  await expect(page.locator(`${ledger} footer strong`)).toHaveText('1 / 2')

  await page.getByLabel('搜索渠道账单').fill('八')
  await expect(select).toHaveValue('')
  await expect(page.locator(rows)).toHaveCount(14)
  await select.selectOption('百分')
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await expect(select).toHaveValue('')
  await expect(page.getByRole('button', { name: '清除渠道筛选' })).toHaveCount(0)
  expect(requests.sort()).toEqual(['GET /api/auth/me', 'GET /api/bill-lifecycle/archive'])
})

test('channel selection combines with game/month filters and keeps archive choices available', async ({ page }) => {
  await open(page)
  const select = page.getByLabel('筛选明细渠道')
  await select.selectOption('百分')
  await page.getByRole('button', { name: '更多筛选', exact: true }).click()
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

test('compact filters occupy one desktop row and remain usable on phones', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await open(page)
  await expect(page.locator('.channel-ledger-extra-filters')).toHaveCount(0)
  await expect(page.getByLabel('搜索渠道', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('游戏名称', { exact: true })).toHaveCount(0)
  const boxes = await page.locator('.channel-ledger-filters__main > *').evaluateAll(elements =>
    elements.map(element => ({ bottom: element.getBoundingClientRect().bottom })))
  expect(boxes).toHaveLength(5)
  expect(new Set(boxes.map(box => box.bottom)).size).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('filters-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '更多筛选', exact: true }).click()
  const bounds = await page.locator('.channel-ledger-filters :is(input, select, button)').evaluateAll(elements =>
    elements.map(element => ({ x: element.getBoundingClientRect().x, right: element.getBoundingClientRect().right })))
  for (const bound of bounds) {
    expect(bound.x).toBeGreaterThanOrEqual(0)
    expect(bound.right).toBeLessThanOrEqual(390)
  }
  await page.screenshot({ path: testInfo.outputPath('filters-mobile.png') })
  await page.getByLabel('筛选明细渠道').selectOption('八门')
  await expect(page.locator(rows)).toHaveCount(14)
})

test('collapsed advanced filters remain visible as removable conditions; month and range are exclusive', async ({ page }) => {
  await open(page)
  await page.getByLabel('筛选明细渠道').selectOption('百分')
  await page.getByRole('button', { name: '更多筛选', exact: true }).click()
  await page.getByLabel('游戏名称', { exact: true }).fill('游戏甲')
  await page.getByLabel('起始月份', { exact: true }).fill('2026-09')
  await page.getByLabel('结束月份', { exact: true }).fill('2026-09')
  await page.getByLabel('排序方式', { exact: true }).selectOption('month-asc')
  await expect(page.locator(rows)).toHaveCount(3)
  await page.getByRole('button', { name: /收起筛选/ }).click()
  await expect(page.getByRole('button', { name: '更多筛选（3）', exact: true })).toBeVisible()
  await expect(page.getByLabel('已选筛选条件')).toContainText('2026-09 至 2026-09')
  await page.getByRole('button', { name: '清除游戏筛选', exact: true }).click()
  await expect(page.locator(rows)).toHaveCount(7)
  await page.getByLabel('筛选明细结算月份').selectOption('2026-08')
  await expect(page.getByRole('button', { name: '清除日期范围筛选' })).toHaveCount(0)
  await expect(page.locator(rows)).toHaveCount(7)
  await page.getByRole('button', { name: /更多筛选/ }).click()
  await expect(page.getByLabel('起始月份', { exact: true })).toHaveValue('')
  await page.getByLabel('起始月份', { exact: true }).fill('2026-09')
  await expect(page.getByLabel('筛选明细结算月份')).toHaveValue('')
  await page.getByLabel('结束月份', { exact: true }).fill('2026-08')
  await expect(page.getByText('起始月份不能晚于结束月份')).toBeVisible()
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await expect(page.getByLabel('已选筛选条件')).toHaveCount(0)
  await expect(page.getByLabel('起始月份', { exact: true })).toHaveCount(0)
  await expect(page.locator(rows)).toHaveCount(28)
})

test('status filtering and audit month navigation still use the shared controls', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '更多筛选', exact: true }).click()
  await page.getByLabel('筛选渠道账单状态').selectOption('cancelled')
  await expect(page.locator('.channel-flat-ledger__empty')).toBeVisible()
  await page.getByRole('button', { name: '清除账单状态筛选' }).click()
  await expect(page.locator(rows)).toHaveCount(28)
  await page.getByLabel('筛选明细渠道').selectOption('百分')
  await page.getByRole('tab', { name: '账期巡检', exact: true }).click()
  await page.getByLabel('截至哪个已结束账期').fill('2026-09')
  await expect(page.locator('.channel-month-audit__matrix tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: '查看百分2026年9月已录账单', exact: true }).click()
  await expect(page.getByRole('tab', { name: '账单明细', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('筛选明细渠道')).toHaveValue('百分')
  await expect(page.getByLabel('筛选明细结算月份')).toHaveValue('2026-09')
  await expect(page.locator(rows)).toHaveCount(7)
})


test('review and cash collection are separate labels in the visible channel bill table', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await open(page)
  const headers = page.locator('.channel-flat-ledger__table thead th')
  await expect(headers.filter({ hasText: '核对状态' })).toHaveCount(1)
  await expect(headers.filter({ hasText: '收款状态' })).toHaveCount(1)
  const first = page.locator('.channel-flat-ledger__table tbody tr').first()
  await expect(first.getByRole('group', { name: '核对状态：已核对' })).toBeVisible()
  await expect(first.getByRole('group', { name: '收款状态：未收款' })).toBeVisible()
  await expect(first.getByText('已核对', { exact: true })).toBeVisible()
  await expect(first.getByText('未收款', { exact: true })).toBeVisible()
  await expect(first.getByText('数据差异', { exact: true })).toHaveCount(0)
})


test('channel keyword search finds historical 游海 / 麦游 account records without merging legal parties', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/bill-lifecycle/archive')
      return route.fulfill({ json: { archived_ids: [], eligible_ids: [], items: [] } })
    if (path === '/api/auth/me')
      return route.fulfill({ json: { role: 'admin', permissions: [] } })
    return route.abort()
  })
  await page.goto('/tests/fixtures/channel-detail.html?legacy-aliases=1')
  const tbody = page.locator('.channel-flat-ledger__table tbody')
  const input = page.getByLabel('搜索渠道账单')
  await expect(page.locator(rows)).toHaveCount(3)
  for (const word of ['游海', '麦游', '海游', '游海（麦游）', '游海(麦游)']) {
    await input.fill(word)
    await expect(page.locator(rows)).toHaveCount(2)
    await expect(tbody).toContainText('西安游海网络科技有限公司')
    await expect(tbody).toContainText('西安麦游网络科技有限公司')
    await expect(tbody).toContainText('¥3,119.46')
    await expect(tbody).toContainText('¥2,802.70')
  }
  // Full legal partner names are precise and never made synonymous.
  await input.fill('西安游海网络科技有限公司')
  await expect(page.locator(rows)).toHaveCount(1)
  await expect(tbody).not.toContainText('西安麦游网络科技有限公司')
  await input.fill('西安麦游网络科技有限公司')
  await expect(page.locator(rows)).toHaveCount(1)
  await expect(tbody).not.toContainText('西安游海网络科技有限公司')
})


test('coverage audit shares the historical 游海/麦游 search with channel bill list', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 })
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/api/bill-lifecycle/archive')
      return route.fulfill({ json: { archived_ids: [], eligible_ids: [], items: [] } })
    if (pathname === '/api/auth/me')
      return route.fulfill({ json: { role: 'admin', permissions: [] } })
    return route.abort()
  })
  await page.goto('/tests/fixtures/channel-detail.html?legacy-aliases=1')
  const search = page.getByLabel('搜索渠道账单')
  const auditRows = page.locator('.channel-month-audit__matrix tbody tr')

  for (const keyword of ['麦游', '海游', '游海（麦游）']) {
    await search.fill(keyword)
    // Same source rows must be discoverable in both views, even when the
    // legacy display label has already been renamed in memory.
    await expect(page.locator(rows)).toHaveCount(2)
    await page.getByRole('tab', { name: '账期巡检', exact: true }).click()
    await expect(auditRows).toHaveCount(2)
    await expect(page.getByText('未找到匹配的渠道')).toHaveCount(0)
    await expect(page.locator('.channel-month-audit__matrix')).toContainText('游海')
    await expect(page.locator('.channel-month-audit__matrix')).toContainText('麦游')
    await page.getByRole('tab', { name: '账单明细', exact: true }).click()
  }

  // Full legal name remains a precise lookup, not a synonym of the other company.
  await search.fill('西安游海网络科技有限公司')
  await expect(page.locator(rows)).toHaveCount(1)
  await page.getByRole('tab', { name: '账期巡检', exact: true }).click()
  await expect(auditRows).toHaveCount(1)
  await expect(page.locator('.channel-month-audit__matrix')).toContainText('游海')
  await expect(page.locator('.channel-month-audit__matrix')).not.toContainText('麦游</strong>')
})

for (const { width, height, zoom } of [
  { width: 1600, height: 900, zoom: 1 },
  { width: 1280, height: 720, zoom: 1.25 },
  { width: 1000, height: 800, zoom: 2 },
  { width: 390, height: 844, zoom: 1 }
]) {
  test(`filter chips remain inside toolbar above review shortcuts at ${width}px / ${zoom * 100}%`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height })
    await open(page)
    // Match the production shell's constrained flex column; auto-height fixtures
    // cannot expose toolbar shrinkage when a long ledger fills the viewport.
    await page.locator('main').evaluate((element, scale) => {
      element.style.cssText += `;height:100vh;display:flex;flex-direction:column;overflow:auto;zoom:${scale}`
    }, zoom)
    await page.getByLabel('筛选明细结算月份').selectOption('2026-08')
    await page.getByLabel('筛选明细渠道').selectOption('百分')
    const checkGeometry = async () => {
      const geometry = await page.evaluate(() => {
        const box = selector => {
          const rect = document.querySelector(selector).getBoundingClientRect()
          return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
        }
        return { toolbar: box('.core-recon-workbar'), filters: box('.channel-ledger-filters'),
          active: box('.channel-ledger-filters__active'), review: box('.channel-ledger-review-filter') }
      })
      expect(geometry.toolbar.bottom, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.filters.bottom - 1)
      expect(geometry.review.top, JSON.stringify(geometry)).toBeGreaterThan(geometry.active.bottom)
    }
    await checkGeometry()
    await page.getByRole('button', { name: '更多筛选', exact: true }).click()
    await page.getByLabel('游戏名称', { exact: true }).fill('用于验证筛选条件自然换行的长游戏名称'.repeat(3))
    await page.getByLabel('排序方式', { exact: true }).selectOption('month-asc')
    await checkGeometry()
    await page.getByRole('button', { name: /收起筛选/ }).click()
    await checkGeometry()
    await page.screenshot({ path: testInfo.outputPath('filters-wrapped-conditions.png') })
    await page.getByLabel('清除游戏筛选', { exact: true }).click()
    await expect(page.locator(rows)).toHaveCount(7)
    await page.screenshot({ path: testInfo.outputPath('filters-no-overlap.png') })
  })
}

async function openCumulative(page, { fail = false, hold } = {}) {
  const reads = []
  const writes = []
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() !== 'GET') writes.push(request.method() + ' ' + url.pathname)
    if (url.pathname.endsWith('/bill-statuses')) {
      const ids = url.searchParams.get('bill_ids').split(',')
      reads.push(ids)
      if (hold) await hold
      if (fail) return route.fulfill({ status: 503, json: { detail: 'unavailable' } })
      return route.fulfill({ json: { items: ids.map(bill_id => ({
        bill_id,
        mode: bill_id === 'missing-mode' ? undefined : bill_id.startsWith('threshold-') ? 'threshold' : 'periodic',
        state: bill_id === 'threshold-active' ? 'accumulating' : bill_id === 'threshold-ready' ? 'ready' : 'normal',
        deferred: ['threshold-active', 'threshold-ready'].includes(bill_id),
        policy: { enabled: bill_id !== 'disabled-policy', settlement_mode: 'threshold' }
      })), total: ids.length } })
    }
    if (url.pathname === '/api/bill-lifecycle/archive')
      return route.fulfill({ json: { archived_ids: ['threshold-archived'], eligible_ids: [], items: [] } })
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { role: 'admin', permissions: [] } })
    return route.fulfill({ json: { items: [], total: 0 } })
  })
  page.on('pageerror', error => { throw error })
  await page.goto('/tests/fixtures/channel-detail.html?cumulative=1')
  await expect(page.locator(rows)).toHaveCount(7)
  return { reads, writes }
}

const billRow = (page, id) => page.locator(rows).filter({ has: page.locator('.channel-flat-ledger__game small', { hasText: id }) })

test('cumulative column uses explicit mode for pending, paid and archived bills without changing actions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const { reads, writes } = await openCumulative(page)
  await expect(page.locator(`${ledger} thead th`)).toHaveText([
    '', '结算月份', '渠道 / 合作方', '游戏 / 账单编号', '渠道应收', '已收', '未收', '核对状态', '累计结算', '收款状态', '操作'
  ])
  for (const id of ['threshold-pending', 'threshold-active', 'threshold-ready', 'threshold-paid']) {
    await expect(billRow(page, id).getByRole('group', { name: '累计结算：累计结算', exact: true })).toBeVisible()
  }
  await expect(billRow(page, 'periodic').getByRole('group', { name: '累计结算：/', exact: true })).toHaveText('/')
  await expect(billRow(page, 'disabled-policy').getByRole('group', { name: '累计结算：/', exact: true })).toHaveText('/')
  await expect(billRow(page, 'missing-mode').getByRole('group', { name: '累计结算：待确认', exact: true })).toBeVisible()
  await expect(billRow(page, 'threshold-active').getByText('累计中', { exact: true })).toHaveCount(1)
  await expect(billRow(page, 'threshold-ready').getByText('累计达标', { exact: true })).toBeVisible()
  await expect(billRow(page, 'threshold-active').getByRole('group', { name: '收款状态：未收款', exact: true })).toHaveText('未收款')
  await expect(billRow(page, 'threshold-active').getByRole('button', { name: '收款', exact: true })).toBeDisabled()
  await expect(billRow(page, 'periodic').getByRole('button', { name: '收款', exact: true })).toBeEnabled()
  await expect(billRow(page, 'threshold-paid').getByRole('button', { name: '已结清', exact: true })).toBeDisabled()
  await expect(billRow(page, 'threshold-pending').getByRole('group', { name: '核对状态：待核对', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('cumulative-column-desktop.png') })
  await page.getByRole('button', { name: /归档账单/ }).click()
  await expect(billRow(page, 'threshold-archived').getByRole('group', { name: '累计结算：累计结算', exact: true })).toBeVisible()
  await expect(billRow(page, 'threshold-archived').getByRole('button', { name: '取消归档', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: /垃圾桶/ }).click()
  await expect(billRow(page, 'threshold-cancelled').getByRole('group', { name: '累计结算：累计结算', exact: true })).toBeVisible()
  await expect(billRow(page, 'threshold-cancelled').getByRole('button', { name: '恢复', exact: true })).toBeEnabled()
  expect(reads.some(ids => ids.includes('threshold-paid'))).toBe(true)
  expect(reads.some(ids => ids.includes('threshold-archived'))).toBe(true)
  expect(writes).toEqual([])
})

test('missing cumulative API data is never presented as ordinary settlement', async ({ page }) => {
  const { writes } = await openCumulative(page, { fail: true })
  await expect(page.getByText('累计状态读取失败，收款仍由后台校验')).toBeVisible()
  await expect(page.locator('.channel-flat-ledger__cumulative-cell')).toHaveText(Array(7).fill('待确认'))
  expect(writes).toEqual([])
})

test('cumulative type waits for its source and fits a narrow horizontally scrollable table', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let release
  const hold = new Promise(resolve => { release = resolve })
  await openCumulative(page, { hold })
  await expect(page.locator('.channel-flat-ledger__cumulative-cell').first()).toHaveText('读取中…')
  release()
  await expect(billRow(page, 'periodic').getByRole('group', { name: '累计结算：/', exact: true })).toHaveText('/')
  const heading = page.getByRole('columnheader', { name: '累计结算', exact: true })
  await billRow(page, 'threshold-pending').getByRole('group', { name: '累计结算：累计结算', exact: true })
    .evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }))
  await heading.evaluate(element => {
    const scroller = element.closest('.channel-flat-ledger__scroll')
    scroller.scrollLeft += element.getBoundingClientRect().left - scroller.getBoundingClientRect().left - 20
  })
  await expect(heading).toBeInViewport()
  await expect(billRow(page, 'threshold-pending').getByRole('group', { name: '累计结算：累计结算', exact: true })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('cumulative-column-mobile.png') })
})
