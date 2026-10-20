import { test, expect } from '@playwright/test'

async function openReadOnly(page) {
  const methods = []
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request()
    methods.push({ method: request.method(), path: new URL(request.url()).pathname })
    if (new URL(request.url()).pathname === '/api/auth/me') {
      return route.fulfill({
        json: { id: 'daxiong-layout-admin', display_name: '布局测试管理员', role: 'admin', permissions: [] }
      })
    }
    return route.fulfill({ json: { items: [], permissions: [], roles: [] } })
  })
  await page.goto('/tests/fixtures/daxiong-responsive.html')
  await expect(page.locator('.so-page')).toBeVisible()
  await expect(page.getByRole('button', { name: '经营总览' })).toBeVisible()
  return methods
}

async function measure(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.so-page')
    const cols = document.querySelector('.so-columns')
    const metrics = document.querySelector('.so-metrics')
    const table = document.querySelector('.so-table')
    const rows = document.querySelector('.so-table tbody tr')
    const tableScroll = document.querySelector('.so-scroll')
    const trackCount = selector => {
      const element = document.querySelector(selector)
      return element ? getComputedStyle(element).gridTemplateColumns.split(/\s+/).length : 0
    }
    return {
      rootWidth: Math.round(root.getBoundingClientRect().width),
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      rootOverflow: root.scrollWidth - root.clientWidth,
      panelOverflow: tableScroll.scrollWidth - tableScroll.clientWidth,
      tableFont: parseFloat(getComputedStyle(table).fontSize),
      metricLabelFont: parseFloat(getComputedStyle(document.querySelector('.so-metric > span')).fontSize),
      columns: trackCount('.so-columns'),
      metrics: trackCount('.so-metrics'),
      rowDisplay: getComputedStyle(rows).display,
      tableHeadDisplay: getComputedStyle(document.querySelector('.so-table thead')).display
    }
  })
}

const viewports = [
  { width: 1920, height: 1080, columns: 2, metrics: 4, mobileCards: false },
  { width: 1366, height: 900, columns: 2, metrics: 4, mobileCards: false },
  { width: 1024, height: 768, columns: 1, metrics: 2, mobileCards: false },
  { width: 768, height: 1024, columns: 1, metrics: 2, mobileCards: false },
  { width: 390, height: 844, columns: 1, metrics: 2, mobileCards: true },
  { width: 320, height: 720, columns: 1, metrics: 2, mobileCards: true }
]

for (const size of viewports) {
  test(`Daxiong adapts to ${size.width}px with no page overflow`, async ({ page }, info) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    const requests = await openReadOnly(page)
    const actual = await measure(page)
    expect(actual.columns).toBe(size.columns)
    expect(actual.metrics).toBe(size.metrics)
    expect(actual.documentOverflow).toBeLessThanOrEqual(2)
    expect(actual.rootOverflow).toBeLessThanOrEqual(2)
    expect(actual.tableFont).toBeGreaterThanOrEqual(13)
    expect(actual.metricLabelFont).toBeGreaterThanOrEqual(12)
    if (size.mobileCards) {
      expect(actual.rowDisplay).toBe('grid')
      expect(actual.tableHeadDisplay).toBe('none')
      expect(actual.panelOverflow).toBeLessThanOrEqual(2)
      await expect(page.locator('.so-game-table tbody td[data-label="现金实付"]')).toHaveCount(6)
    } else {
      expect(actual.tableHeadDisplay).toBe('table-header-group')
    }
    expect(requests.filter(x => !['GET', 'HEAD'].includes(x.method))).toEqual([])
    await page.screenshot({ path: info.outputPath(`daxiong-${size.width}.png`), fullPage: false })
  })
}

test('resizes without reloading or losing current month and active tab', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const requests = await openReadOnly(page)
  await page.getByLabel('账期').selectOption('2026-08')
  await page.getByRole('tab', { name: '游戏利润' }).click()
  await expect(page.getByRole('tabpanel', { name: '游戏利润' })).toBeVisible()
  await expect(page.getByText('¥16,500.20').first()).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByLabel('账期')).toHaveValue('2026-08')
  await expect(page.getByRole('tab', { name: '游戏利润' })).toHaveAttribute('aria-selected', 'true')
  const mobile = await measure(page)
  expect(mobile.rowDisplay).toBe('grid')
  expect(mobile.rootOverflow).toBeLessThanOrEqual(2)
  await page.setViewportSize({ width: 1920, height: 1080 })
  const desktop = await measure(page)
  expect(desktop.columns).toBe(2)
  expect(desktop.rootOverflow).toBeLessThanOrEqual(2)
  expect(requests.filter(x => !['GET', 'HEAD'].includes(x.method))).toEqual([])
})

test('buying and contract tabs adapt as cards on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const requests = await openReadOnly(page)
  for (const tab of ['买量管理', '合同关联']) {
    await page.getByRole('tab', { name: tab }).click()
    const layout = await measure(page)
    expect(layout.rowDisplay).toBe('grid')
    expect(layout.tableHeadDisplay).toBe('none')
    expect(layout.rootOverflow).toBeLessThanOrEqual(2)
    expect(layout.documentOverflow).toBeLessThanOrEqual(2)
  }
  expect(requests.filter(x => !['GET', 'HEAD'].includes(x.method))).toEqual([])
})
