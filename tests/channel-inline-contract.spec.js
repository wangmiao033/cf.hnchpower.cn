import { test, expect } from '@playwright/test'

const ITEM = {
  id:'A1',contract_id:'C1',channel_name:'湖南芯动',agreement_type:'渠道合作',platform_record_id:'P-001',
  product_name:'龙吟大陆',app_id:'com.gaming',platform:'Android',language:'zh',category:'游戏',
  rights_source:'代理授权',game_status:'在营',agreement_status:'有效',authorization_start:null,
  authorization_end:null,share_rate:'30.00',channel_fee_rate:'0.00',software_copyright_no:'soft-123',
  isbn:'ISBN-TEST',territory:'中国',status:'生效',remarks:'合作项目已有备注',
  updated_at:'2026-10-14T09:00:00Z'
}
const CONTRACT = {
  id:'C1',contract_name:'渠道合作协议',contract_no:'',partner_name:'湖南芯动网络科技有限公司',
  partner_short_name:'湖南芯动',counterparty:'湖南芯动网络科技有限公司',access_items:[ITEM]
}
function intercept(page, writes) {
  return page.route(url => url.pathname.startsWith('/api/'), route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/contracts' && route.request().method()==='GET') {
      return route.fulfill({json:{items:[CONTRACT],total:1}})
    }
    if (path === '/api/contracts/C1/access-items/A1' && route.request().method()==='PUT') {
      writes.push(route.request().postDataJSON())
      return route.fulfill({json:{...ITEM,...writes.at(-1)}})
    }
    return route.abort()
  })
}

test('red contract warning can be reviewed in-place without touching bill amounts or other access terms',async ({page})=>{
  const writes=[]
  await intercept(page,writes)
  page.on('dialog', async dialog => dialog.accept())
  await page.goto('/tests/fixtures/channel-inline-contract.html')
  const dialog=page.getByRole('dialog',{name:'本页核对合同'})
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('龙吟大陆')
  await expect(dialog).toContainText('未注明')
  await expect(dialog).toContainText('30.00%')
  await expect(dialog).toContainText('0.00%')
  expect(writes).toHaveLength(0)

  await page.getByLabel('合同游戏名称').fill('龙吟大陆（内置0.1折正版放置手游）')
  await page.getByLabel('授权开始').fill('2025-07-01')
  await page.getByLabel('授权结束').fill('2025-12-31')
  await page.getByLabel('合同核对依据').fill('已核对真实合同和游戏合作清单')
  await page.getByLabel('我已核对合同原件').check()
  await page.getByRole('button',{name:'保存合同信息并重新匹配'}).click()
  await expect(page.getByTestId('saved-count')).toHaveText('1')
  await expect(page.getByTestId('ledger-amount')).toHaveText('1174.72')
  expect(writes).toHaveLength(1)
  expect(writes[0].product_name).toBe('龙吟大陆（内置0.1折正版放置手游）')
  expect(writes[0].authorization_start).toBe('2025-07-01')
  expect(writes[0].authorization_end).toBe('2025-12-31')
  expect(writes[0].share_rate).toBe('30.00')
  expect(writes[0].channel_fee_rate).toBe('0.00')
  expect(writes[0].software_copyright_no).toBe('soft-123')
  expect(writes[0].isbn).toBe('ISBN-TEST')
  expect(writes[0].app_id).toBe('com.gaming')
  expect(writes[0].remarks).toContain('合作项目已有备注')
  expect(writes[0].remarks).toContain('已核对真实合同')
})

test('out-of-range authorization dates are blocked instead of faked into coverage',async ({page})=>{
  const writes=[]
  await intercept(page,writes)
  await page.goto('/tests/fixtures/channel-inline-contract.html')
  await page.getByLabel('授权开始').fill('2025-08-01')
  await page.getByLabel('合同核对依据').fill('已核对真实签署合同信息')
  await page.getByLabel('我已核对合同原件').check()
  await page.getByRole('button',{name:'保存合同信息并重新匹配'}).click()
  await expect(page.getByRole('alert')).toContainText('不包含当前账期')
  expect(writes).toHaveLength(0)
  await expect(page.getByTestId('saved-count')).toHaveText('0')
})

test('unchanged contract candidate cannot be falsely marked resolved by clicking confirm',async ({page})=>{
  const writes=[]
  await intercept(page,writes)
  await page.goto('/tests/fixtures/channel-inline-contract.html')
  await page.getByLabel('合同核对依据').fill('已核对真实签署合同信息')
  await page.getByLabel('我已核对合同原件').check()
  await page.getByRole('button',{name:'保存合同信息并重新匹配'}).click()
  await expect(page.getByRole('alert')).toContainText('资料没有变化')
  expect(writes).toHaveLength(0)
})
