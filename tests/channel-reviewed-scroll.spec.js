import { test, expect } from '@playwright/test'
const record = {
  id: 'XIAOMI-202609', statement_no: 'QD-20261010-09CA29',
  channel_name: '瓦力（小米）', partner_name: '北京瓦力网络科技有限公司',
  settlement_month: '2026-09', status: 'confirmed', billing_flow: 1128,
  billing_amount: 1001.70, voucher_cost: 126.30, share_amount: 500.85,
  platform_settlement_amount: 475.81, system_settlement_amount: 475.81,
  settlement_amount: 475.81, received_amount: 0, settlement_difference: 0,
  validation_status: 'pass', remark: '小米平台已确认，满1000后结算',
  channel_fee_rate: 5, channel_fee_mode: 'percent',
  settlement_rule_code: 'five_percent_gateway_share', tax_mode: 'none',
  items: [
    ['仙帝神兵', 6, .90, 2.42],
    ['六界仙尊', 30, 24, 2.85],
    ['六界仙尊', 648, 34.80, 291.27],
    ['帝国雄师', 444, 66.60, 179.27]
  ].map(([game, flow, voucher, amount], i) => ({
    id: 'line-'+i, settlement_cycle:'2026-09', game_name:game,
    billing_flow:flow, discount_factor:1, voucher_cost:voucher,
    no_worry_cost:0, refund_cost:0, test_cost:0, welfare_cost:0, coin_cost:0,
    share_rate:50, tax_rate:0, gateway_cost:0, channel_fee_rate:5,
    settlement_rule_code:'five_percent_gateway_share', channel_fee_mode:'percent',
    tax_mode:'none', validation_tolerance:.05, billing_amount:flow-voucher,
    share_amount:(flow-voucher)*.5, platform_settlement_amount:amount,
    system_settlement_amount:amount, settlement_amount:amount,
    settlement_difference:0, validation_status:'pass'
  }))
}

test('read-only channel scroll has no ghosting or repeated attachment requests', async ({ page }) => {
  const requests = []
  const errors = []
  const consoleErrors = []
  page.on('console', item => {
    if (item.type() === 'error') consoleErrors.push(item.text())
  })
  await page.setViewportSize({ width: 1180, height: 520 })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    requests.push(route.request().method()+' '+path)
    if (path === '/api/channel-records/XIAOMI-202609')
      return route.fulfill({json:record})
    if (path === '/api/bill-attachments/channel/XIAOMI-202609')
      return route.fulfill({json:{items:[{
        id:'A1',bill_type:'channel',bill_id:'XIAOMI-202609',
        file_name:'小米原始结算单.pdf',file_size:9000
      }]}})
    return route.abort()
  })
  await page.goto('/tests/fixtures/channel-reviewed-scroll.html')
  const panel = page.locator('.channel-readonly-view')
  const folds = panel.locator('details.channel-readonly-fold')
  await page.waitForTimeout(600)
  if (!(await panel.count())) {
    throw new Error('Fixture failed to render: ' + JSON.stringify({
      errors, consoleErrors, requests,
      html: (await page.locator('#fixture').innerHTML()).slice(0, 600)
    }))
  }
  await expect(panel.locator('.is-brief-games tbody tr')).toHaveCount(4)
  await expect(folds).toHaveCount(4)
  expect(requests).toEqual(['GET /api/channel-records/XIAOMI-202609'])
  await expect(folds.nth(0).locator('table')).toHaveCount(0)

  for (let i = 0; i < 3; i++) {
    await folds.nth(0).locator('summary').click()
    await expect(folds.nth(0).locator('table')).toBeVisible()
    await folds.nth(0).locator('summary').click()
    await expect(folds.nth(0).locator('table')).toHaveCount(0)
  }
  await folds.nth(1).locator('summary').click()
  await expect(folds.nth(1).locator('.channel-readonly-metrics')).toBeVisible()
  await page.evaluate(() => window.scrollBy(0, 300))
  const coords = await panel.evaluate(root => {
    const rect = root.querySelector('.is-brief-games').getBoundingClientRect()
    return {
      lastGameBottom: rect.bottom,
      foldStarts:[...root.querySelectorAll('details.channel-readonly-fold')].map(x=>x.getBoundingClientRect().top),
      headerPosition: getComputedStyle(root.querySelector('.channel-readonly-table--brief th')).position,
      foldOverflow: getComputedStyle(root.querySelector('details.channel-readonly-fold')).overflowY
    }
  })
  expect(coords.foldStarts.every(top=>top >= coords.lastGameBottom-1)).toBe(true)
  expect(coords.headerPosition).toBe('static')
  expect(coords.foldOverflow).toBe('visible')

  await folds.nth(3).locator('summary').click()
  await expect(folds.nth(3).getByText('小米原始结算单.pdf')).toBeVisible()
  expect(requests.filter(r=>r==='GET /api/bill-attachments/channel/XIAOMI-202609')).toHaveLength(1)
  await folds.nth(3).locator('summary').click()
  await folds.nth(3).locator('summary').click()
  await expect(folds.nth(3).getByText('小米原始结算单.pdf')).toBeVisible()
  expect(requests.filter(r=>r==='GET /api/bill-attachments/channel/XIAOMI-202609')).toHaveLength(1)
  expect(errors).toEqual([])
})
