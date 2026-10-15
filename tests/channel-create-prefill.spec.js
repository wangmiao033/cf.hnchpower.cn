import { test, expect } from '@playwright/test'

const contractResponse = {
  partner_rule_status:'none', partner_rule_message:'暂无合同合作清单',
  partner_auto_apply:false, auto_apply:false, header_recommendation:null, lines:[]
}
async function open(page, url) {
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    if (new URL(route.request().url()).pathname === '/api/contract-terms/channel-rule-recommendation') {
      return route.fulfill({json: contractResponse})
    }
    return route.abort()
  })
  await page.goto(url)
}

test('new bill from vivo search inherits exact customer association, not old games or payment figures', async ({page}) => {
  await open(page, '/tests/fixtures/channel-create-prefill.html')
  await expect(page.getByRole('combobox',{name:'搜索客户库合作方'})).toHaveValue('维沃移动通信有限公司')
  await expect(page.locator('.rd-partner-picker__link-state')).toContainText('已关联客户库')
  await expect(page.locator('table.channel-line-items-table tbody tr')).toHaveCount(1)
  const record = await expect.poll(async() => {
    try { return JSON.parse(await page.getByTestId('calculated-record').textContent()) } catch { return null }
  }).toMatchObject({ partnerName:'维沃移动通信有限公司',channelName:'vivo天鑫' })
  const state=JSON.parse(await page.getByTestId('calculated-record').textContent())
  expect(state.items).toHaveLength(1)
  expect(state.items[0].gameName).toBe('')
  expect(state.items[0].flow).toBe(0)
  expect(state.settlementMonth).toBeFalsy()
})

test('generic top/sidebar new bill still remains blank when no channel is selected',async ({page}) => {
  await open(page, '/tests/fixtures/channel-create-prefill.html?blank=1')
  await expect(page.getByRole('combobox',{name:'搜索客户库合作方'})).toHaveValue('')
  await expect(page.locator('table.channel-line-items-table tbody tr')).toHaveCount(1)
  const state=JSON.parse(await page.getByTestId('calculated-record').textContent())
  expect(state.partnerName).toBe('')
  expect(state.channelName).toBe('')
})
