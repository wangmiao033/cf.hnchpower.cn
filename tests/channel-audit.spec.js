import { test, expect } from '@playwright/test'

const matrix = '.channel-month-audit__matrix'
const scroll = '.channel-month-audit__scroll'
async function open(page, rows = 4) {
  // This fixture mounts the real component with synthetic data and the app CSS cascade.
  // No authenticated session or production API is used.
  await page.route(url => url.pathname.startsWith('/api/'), route => route.abort())
  page.on('pageerror', error => { throw error })
  await page.goto(`/tests/fixtures/channel-audit.html?rows=${rows}`)
  await expect(page.locator(`${matrix} tbody tr`)).toHaveCount(rows)
  await page.getByRole('checkbox', { name: '只显示断档渠道' }).uncheck()
}
async function dimensions(page) {
  return page.locator(matrix).evaluate(table => {
    const wrap = table.parentElement
    const body = wrap.parentElement
    return {
      table: table.getBoundingClientRect().width,
      clientWidth: wrap.clientWidth,
      scrollWidth: wrap.scrollWidth,
      height: wrap.getBoundingClientRect().height,
      clientHeight: wrap.clientHeight,
      scrollHeight: wrap.scrollHeight,
      padding: parseFloat(getComputedStyle(body).paddingLeft),
      columns: Array.from(table.tHead.rows[0].cells, cell => cell.getBoundingClientRect().width)
    }
  })
}

test('desktop fills its container, distributes months equally and fits four rows', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await open(page)
  for (const months of [6, 3, 12]) {
    await page.getByLabel('选择检查账期范围').selectOption(String(months))
    const d = await dimensions(page)
    expect(d.padding).toBeGreaterThanOrEqual(8)
    expect(d.padding).toBeLessThanOrEqual(12)
    expect(Math.abs(d.table - d.clientWidth)).toBeLessThanOrEqual(1)
    expect(d.columns[0]).toBeCloseTo(280, 0)
    expect(d.columns.at(-1)).toBeCloseTo(210, 0)
    const widths = d.columns.slice(1, -1)
    expect(widths).toHaveLength(months)
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1)
    expect(d.height).toBeLessThan(400)
    expect(d.scrollHeight).toBeLessThanOrEqual(d.clientHeight)
  }
  expect(await page.getByLabel('在巡检中搜索渠道').evaluate(el => el.offsetWidth)).toBeGreaterThan(240)
})

test('long lists scroll only after reaching 600px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await open(page, 30)
  const d = await dimensions(page)
  expect(d.height).toBeCloseTo(600, 0)
  expect(d.scrollHeight).toBeGreaterThan(d.clientHeight)
  await page.locator(scroll).evaluate(el => { el.scrollTop = el.scrollHeight })
  expect(await page.locator(scroll).evaluate(el => el.scrollTop)).toBeGreaterThan(0)
})

test('small screens wrap filters and scroll the table without widening the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  for (const months of [3, 6, 12]) {
    await page.getByLabel('选择检查账期范围').selectOption(String(months))
    const d = await dimensions(page)
    expect(d.scrollWidth).toBeGreaterThan(d.clientWidth)
    expect(d.columns[0]).toBeCloseTo(280, 0)
    expect(d.columns.at(-1)).toBeCloseTo(210, 0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.locator(scroll).evaluate(el => { el.scrollLeft = el.scrollWidth })
    const summary = await page.locator(`${matrix} thead th`).last().boundingBox()
    expect(summary.x + summary.width).toBeLessThanOrEqual(390)
    // Verify the summary is actually exposed, not covered by the pinned channel.
    expect(await page.locator(`${matrix} thead th`).last().evaluate(cell => {
      const rect = cell.getBoundingClientRect()
      return cell.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    })).toBe(true)
  }
})

test('preserves focused channel filtering, archived months and all month callbacks', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '聚焦渠道1', exact: true }).click()
  await expect(page.locator(`${matrix} tbody tr`)).toHaveCount(1)
  const row = page.locator(`${matrix} tbody tr`).first()
  await expect(row.locator('.is-recorded')).toHaveCount(2)
  await expect(row.locator('.is-gap')).toHaveCount(2)
  await expect(row.locator('.is-trailing')).toHaveCount(2)
  for (const kind of ['recorded', 'gap', 'trailing']) {
    const button = row.locator(`.is-${kind} button`).first()
    await button.click()
    const selected = JSON.parse(await page.getByTestId('selection').textContent())
    expect(selected).toMatchObject({ channel: '渠道1', kind })
    expect(selected.month).toMatch(/^20\d{2}-\d{2}$/)
  }
  await page.getByRole('button', { name: '查看全部渠道', exact: true }).click()
  await expect(page.locator(`${matrix} tbody tr`)).toHaveCount(4)
  await page.getByLabel('在巡检中搜索渠道').fill('渠道2')
  await expect(page.locator(`${matrix} tbody tr`)).toHaveCount(1)
  await expect(page.locator(`${matrix} tbody tr`)).toContainText('渠道2')
  await page.getByLabel('在巡检中搜索渠道').fill('不存在')
  await expect(page.getByText('未找到匹配的渠道')).toBeVisible()
})
