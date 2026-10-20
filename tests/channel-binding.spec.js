import { test, expect } from '@playwright/test'
const item = { id: 'access-a', contract_id: 'contract-a', product_name: '测试游戏3折', channel_name: '测试渠道', platform: '全版本', authorization_start: '2020-01-01', authorization_end: '2028-12-31', share_rate: 25, channel_fee_rate: 5, status: '生效' }
const rule = { share_rate: 25, channel_fee_mode: 'percent', channel_fee_rate: 5, tax_rate: 0, tax_mode: 'none', settlement_rule_code: 'five_percent_gateway_share', validation_tolerance: .05 }
async function setup(page, deny = false) {
  const requests = []
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/contracts') return route.fulfill({ json: { items: [{ id: 'contract-a', partner_id: 'partner-a', partner_name: '测试客户有限公司', contract_name: '测试合同', access_items: [item] }], total: 1 } })
    if (path === '/api/contract-terms/channel-rule-recommendation') {
      const body = route.request().postDataJSON(); requests.push(body)
      const lines = body.lines.map(line => ({ ...line, auto_apply: Boolean(line.access_item_id) && !deny, recommended: line.access_item_id && !deny ? rule : null, match: line.access_item_id && !deny ? { access_item_id: 'access-a' } : null, message: deny ? '所选清单不适用于当前渠道' : '尚未选择清单' }))
      return route.fulfill({ json: { lines, auto_apply: false, partner_rule_status: 'ambiguous' } })
    }
    return route.abort()
  })
  await page.goto('/tests/fixtures/channel-binding.html')
  await page.getByRole('button', { name: '本页选择已录入的合作游戏清单' }).click()
  await expect(page.getByRole('button', { name: '使用已有清单重新匹配本行' })).toBeEnabled()
  return requests
}
test('selected full-platform item is verified on actual bill channel and survives save/reopen with 5%', async ({ page }) => {
  const requests = await setup(page)
  await page.getByRole('button', { name: '使用已有清单重新匹配本行' }).click()
  await expect(page.getByTestId('current')).toContainText('"contractAccessItemId":"access-a"')
  expect(requests.filter(r => r.lines.some(l => l.access_item_id)).every(r => r.channel_name === '测试渠道（聚合）')).toBe(true)
  // Wait for the automatic follow-up recommendation to finish for the new ID.
  await expect.poll(() => requests.filter(r => r.lines.some(l => l.access_item_id)).length).toBeGreaterThanOrEqual(2)
  await expect(page.locator('.channel-contract-rule-status')).toContainText('已按当前游戏和账期自动套用合同规则并重新计算')
  await page.getByRole('button', { name: '测试保存', exact: true }).click()
  await expect(page.getByTestId('saved')).toContainText('"contractAccessItemId":"access-a"')
  await page.getByRole('button', { name: '测试重新打开' }).click()
  await expect(page.getByTestId('current')).toContainText('"id":"saved-line-a"')
  const current = JSON.parse(await page.getByTestId('current').textContent())
  expect(current.items[0]).toMatchObject({ contractAccessItemId: 'access-a', channelFeeRate: 5, flow: 6, testCost: 1.8, platformSettlementAmount: 0 })
})
test('server rejection never falls back to local selected rates or claims selection success', async ({ page }) => {
  await setup(page, true)
  await page.getByRole('button', { name: '使用已有清单重新匹配本行' }).click()
  await expect(page.getByRole('dialog')).toContainText('不适用于当前渠道')
  expect(JSON.parse(await page.getByTestId('current').textContent()).items[0].contractAccessItemId).toBeUndefined()
})
