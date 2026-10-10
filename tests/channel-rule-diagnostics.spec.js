import { test, expect } from '@playwright/test'

const rule = { share_rate: 50, channel_fee_mode: 'percent', channel_fee_rate: 5, tax_rate: 0, tax_mode: 'none', settlement_rule_code: 'five_percent_gateway_share', validation_tolerance: 0.05 }
function response(reason) {
  return {
    partner_rule_status: 'uniform', partner_auto_apply: false,
    partner_rule_message: '合作方统一规则：分成50% / 通道费5%',
    message: reason ? '部分明细未自动带入，请核对具体原因' : '已按游戏和账期套用规则',
    auto_apply: !reason, header_recommendation: reason ? null : rule,
    lines: [0, 1].map(index => ({
      line_index: index, game_name: index ? '游戏乙' : '游戏甲', settlement_cycle: '2026-08',
      auto_apply: !index || !reason, recommended: rule,
      message: index && reason ? reason : '合同匹配明确',
      match: { contract_no: `HT-TEST-${index}`, contract_name: '测试合同', authorization_start: '2022-01-01', authorization_end: index && reason ? '2026-07-31' : '2028-12-31' }
    }))
  }
}

test('shows the precise blocked rule instead of the partner baseline; rematch fills each line without changing statement figures', async ({ page }) => {
  const writes = []
  let reason = '已找到合同，但当前账期明确不在授权期内，不能自动带入'
  await page.route('**/api/**', async route => {
    if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue()
    if (route.request().url().endsWith('/api/contract-terms/channel-rule-recommendation')) {
      return route.fulfill({ json: response(reason) })
    }
    writes.push(route.request().method() + ' ' + new URL(route.request().url()).pathname)
    return route.abort()
  })
  await page.goto('/tests/fixtures/channel-rule.html')
  const issues = page.getByLabel('未自动带入的合同规则')
  await expect(issues).toContainText('第 2 行 · 游戏乙 · 2026-08')
  await expect(issues).toContainText(reason)
  await expect(issues).toContainText('分成：50% · 通道费：5%')
  await expect(issues).toContainText('2026-07-31')
  await expect(page.locator('.channel-contract-rule-status')).not.toContainText('合作方统一规则')
  let actual = JSON.parse(await page.getByTestId('calculated-record').textContent())
  expect(actual.items[0].systemSettlementAmount).toBe(2.85)
  expect(actual.items[1].systemSettlementAmount).toBe(0)
  reason = ''
  await page.getByRole('button', { name: '重新匹配', exact: true }).click()
  await expect(issues).toHaveCount(0)
  await expect(page.locator('.channel-contract-rule-status')).toContainText('已按当前游戏和账期自动套用')
  actual = JSON.parse(await page.getByTestId('calculated-record').textContent())
  expect(actual.items[1].systemSettlementAmount).toBe(4161.45)
  expect(actual.systemSettlementAmount).toBe(4164.30)
  expect(actual.items[1].flow).toBe(11662)
  expect(actual.items[1].voucherCost).toBe(2901.05)
  expect(actual.items[1].platformSettlementAmount).toBe(4161.45)
  expect(writes).toEqual([])
})

test('contract conflicts are readable on a phone in compact mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/contract-terms/channel-rule-recommendation', route => route.fulfill({
    json: response('当前游戏/账期存在多个有效合同候选，且结算规则不一致，需要先确认合同归属')
  }))
  await page.goto('/tests/fixtures/channel-rule.html')
  const issues = page.getByLabel('未自动带入的合同规则')
  await expect(issues).toContainText('结算规则不一致')
  await expect(issues).toBeVisible()
  const box = await issues.boundingBox()
  expect(box.x + box.width).toBeLessThanOrEqual(390)
})
