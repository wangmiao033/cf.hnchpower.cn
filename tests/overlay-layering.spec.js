import { test, expect } from '@playwright/test'

const contract = {
  id: 'contract-test', contract_name: '层级回归测试合同', counterparty: '层级测试客户',
  contract_type: '无固定总价合同', timeline_status: '生效中', attachments: [],
  access_items: [{ id: 'access-test', product_name: '测试游戏', channel_name: '测试渠道', platform: '全版本',
    authorization_start: '2026-01-01', authorization_end: '2027-12-31', share_rate: '25', channel_fee_rate: '0', status: '生效' }]
}

async function openFixture(page, mode = 'contract') {
  const writes = []
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${path}`)
    if (path === '/api/auth/me') return route.fulfill({ json: { id: 'test', display_name: '测试账号', role: 'admin', permissions: [] } })
    if (path === '/api/contracts') return route.fulfill({ json: { items: [contract], total: 1, summary: { total: 1 } } })
    if (path === '/api/contracts/contract-test') return route.fulfill({ json: contract })
    if (path.includes('customer-360')) return route.fulfill({ json: {
      partner: { id: 'partner-test', name: '层级测试客户' }, access: { contracts: true }, summary: {},
      contracts: [{ ...contract, products: [], channels: [] }], rd_bills: [], channel_bills: [], invoices: [], bank_transactions: [], recent_activities: []
    } })
    return route.fulfill({ json: { items: [], total: 0, allocations: [], candidates: [] } })
  })
  await page.goto(`/tests/fixtures/overlay-layering.html?mode=${mode}`)
  await expect(page.getByTestId('auth-ready')).toHaveText('true')
  return writes
}

async function centre(locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function expectCovered(page, point, selectors) {
  await expect.poll(() => page.evaluate(({ point, selectors }) =>
    Boolean(document.elementFromPoint(point.x, point.y)?.closest(selectors)), { point, selectors })).toBe(true)
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`backdrop clicks cannot activate tabs, upload or shell navigation at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const writes = await openFixture(page, 'confirm')
    const shellControl = viewport.width > 960
      ? page.locator('.sidebar-rail-button')
      : page.getByRole('button', { name: '打开菜单', exact: true })
    const shellLabel = await shellControl.getAttribute('aria-label')
    const points = await Promise.all([
      centre(page.getByRole('tab', { name: '客户库' })),
      centre(page.locator('.contract-smart-launcher')),
      centre(shellControl)
    ])
    for (const point of points) {
      await page.getByRole('button', { name: '打开测试浮层' }).click()
      await expectCovered(page, point, '.confirm-dialog-overlay')
      await page.mouse.click(point.x, point.y)
      await expect(page.getByRole('alertdialog', { name: '测试确认' })).toHaveCount(0)
      await expect(page.getByTestId('navigations')).toHaveText('0')
      await expect(page.locator('.contract-ai-mask, .mobile-menu')).toHaveCount(0)
      await expect(shellControl).toHaveAttribute('aria-label', shellLabel)
    }
    expect(writes).toEqual([])
  })
}

const cases = [
  ['contract', '.contract-access-workbench-mask', '清单'],
  ['contract-master', '.contract-editor-mask', '编辑'],
  ['contract-details', '.contract-drawer-mask', '查看'],
  ['confirm', '.confirm-dialog-overlay', '打开测试浮层'],
  ['orders', '.so-import-backdrop', '打开测试浮层'],
  ['invoice', '.invoice-preview-backdrop', '打开测试浮层'],
  ['invoice-detail', '.rec-drawer-backdrop, .rec-drawer', '打开测试浮层'],
  ['channel', '.channel-audit-groups-backdrop', '管理关联渠道'],
  ['presets', '.game-presets-dialog-overlay', '🎮 游戏预设'],
  ['customer', '.customer360-backdrop', '打开测试浮层']
]

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  for (const [mode, selectors, trigger] of cases) {
    test(`${mode} covers shell tabs and floating controls at ${viewport.width}px without navigation`, async ({ page }, info) => {
      await page.setViewportSize(viewport)
      const writes = await openFixture(page, mode.startsWith('contract') ? 'contract' : mode)
      const nav = await centre(page.getByRole('tab', { name: '客户库' }))
      const upload = await centre(page.locator('.contract-smart-launcher'))
      const shellControl = await centre(viewport.width > 960
        ? page.locator('.sidebar-rail-button')
        : page.getByRole('button', { name: '打开菜单', exact: true }))
      await page.getByRole('button', { name: trigger, exact: true }).first().click()
      await expect(page.locator(selectors).first()).toBeVisible()
      await expectCovered(page, nav, selectors)
      await expectCovered(page, upload, selectors)
      await expectCovered(page, shellControl, selectors)
      await page.screenshot({ path: info.outputPath(`${mode}-${viewport.width}.png`) })
      // A backdrop is allowed to dismiss; the same click must never reach the tab behind it.
      await page.mouse.click(nav.x, nav.y)
      await expect(page.getByTestId('navigations')).toHaveText('0')
      await expect(page.getByRole('dialog', { name: '智能录入合同' })).toHaveCount(0)
      expect(writes).toEqual([])
    })
  }
}

test('cooperation workbench traps focus, preserves dirty edits, scrolls internally and restores the opener', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const writes = await openFixture(page)
  await page.locator('.contract-filter-card select').first().selectOption('无固定总价合同')
  const opener = page.getByRole('button', { name: '清单', exact: true }).first()
  await opener.click()
  const dialog = page.getByRole('dialog', { name: '合同合作清单' })
  const close = dialog.getByRole('button', { name: '关闭', exact: true })
  await expect(close).toBeFocused()
  await expect(page.locator('#root')).toHaveAttribute('inert', '')
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: '保存并关闭', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await dialog.getByLabel('版本', { exact: false }).selectOption('Android')
  await expect(dialog.getByLabel('版本', { exact: false })).toHaveValue('Android')
  await dialog.getByLabel('合作游戏', { exact: false }).fill('未保存测试')
  page.once('dialog', prompt => prompt.dismiss())
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('合作游戏', { exact: false })).toHaveValue('未保存测试')
  await dialog.locator('.contract-access-more').first().locator('summary').click()
  const scroll = dialog.locator('.contract-access-workbench__scroll')
  const bodyScroll = await page.evaluate(() => window.scrollY)
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight })
  expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(close).toBeVisible()
  expect(await page.evaluate(() => window.scrollY)).toBe(bodyScroll)
  page.once('dialog', prompt => prompt.accept())
  await close.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#root')).not.toHaveAttribute('inert')
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
  await expect(opener).toBeFocused()
  // Repeat open/close and ensure the shell is interactive again, without history changes.
  const url = page.url()
  await opener.click()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.getByRole('tab', { name: '客户库' }).click()
  await expect(page.getByTestId('navigations')).toHaveText('1')
  expect(page.url()).toBe(url)
  expect(writes).toEqual([])
})

test('mobile navigation covers tabs while open and restores its closed launcher layer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const writes = await openFixture(page, 'confirm')
  const nav = await centre(page.getByRole('tab', { name: '客户库' }))
  await page.getByRole('button', { name: '打开菜单', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '系统导航' })).toBeVisible()
  await expectCovered(page, nav, '.mobile-menu, .mobile-menu-overlay')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '系统导航' })).toHaveCount(0)
  await expect(page.locator('.app-shell-mobile-navigation')).toHaveCSS('z-index', '40')
  await page.getByRole('tab', { name: '客户库' }).click()
  await expect(page.getByTestId('navigations')).toHaveText('1')
  expect(writes).toEqual([])
})

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`cooperation workbench fits mobile ${viewport.width}x${viewport.height} with reachable close and save actions`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const writes = await openFixture(page)
    await page.getByRole('button', { name: '清单', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: '合同合作清单' })
    const box = await dialog.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeInViewport()
    await expect(dialog.getByRole('button', { name: '保存并关闭', exact: true })).toBeInViewport()
    await dialog.locator('.contract-access-more').first().locator('summary').click()
    const scroll = dialog.locator('.contract-access-workbench__scroll')
    await scroll.evaluate(element => { element.scrollTop = element.scrollHeight })
    expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(writes).toEqual([])
  })
}

test('customer drawer keeps nested contract above the customer and returns without closing its parent', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const writes = await openFixture(page, 'customer')
  await page.getByRole('button', { name: '打开测试浮层' }).click()
  const customer = page.getByRole('dialog', { name: '客户360详情' })
  await customer.getByRole('button', { name: /^合同/ }).click()
  await customer.getByRole('cell', { name: '层级回归测试合同', exact: true }).click()
  const contractDrawer = page.locator('.contract-drawer-mask')
  await expect(contractDrawer).toBeVisible()
  const close = contractDrawer.getByRole('button', { name: '关闭', exact: true })
  await expectCovered(page, await centre(close), '.contract-drawer-mask')
  await close.click()
  await expect(contractDrawer).toHaveCount(0)
  await expect(customer).toBeVisible()
  await customer.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(customer).toHaveCount(0)
  expect(writes).toEqual([])
})
