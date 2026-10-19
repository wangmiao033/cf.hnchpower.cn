import { test, expect } from '@playwright/test'

async function open(page, view='recon-channel') {
  const writes=[]
  await page.route(url=>url.pathname.startsWith('/api/'),route=>{
    const request=route.request()
    const path=new URL(request.url()).pathname
    const readOnlyCalculation = request.method()==='POST' && ['/api/contract-terms/channel-rule-recommendation','/api/contract-terms/rd-rule-recommendation'].includes(path)
    if (!['GET','HEAD'].includes(request.method()) && !readOnlyCalculation) writes.push(`${request.method()} ${path}`)
    if(path==='/api/auth/me')return route.fulfill({json:{id:'test',display_name:'测试账号',role:'admin',permissions:[]}})
    if(path==='/api/reconciliation/rd-1')return route.fulfill({json:{id:'rd-1',partner_name:'测试研发',settlement_month:'2026-09',statement_no:'RD-TEST-1',status:'pending',settlement_amount:200,items:[{game_name:'测试游戏',revenue:1000,share_ratio:20,tax_rate:0,settlement_amount:200}]}})
    if(path==='/api/bill-lifecycle/archive')return route.fulfill({json:{archived_ids:[],eligible_ids:[],items:[]}})
    if(readOnlyCalculation)return route.fulfill({json:{partner_rule_status:'none',partner_rule_message:'暂无合同合作清单',partner_auto_apply:false,auto_apply:false,header_recommendation:null,lines:[]}})
    return route.fulfill({json:{items:[],permissions:[],roles:[]}})
  })
  await page.goto(`/tests/fixtures/headerless-navigation.html?view=${view}`)
  await expect(page.locator('.app-admin-header')).toHaveCount(0)
  return writes
}

for (const context of ['selected channel','search']) {
test(`real production channel page retains controls and carries ${context} into actual create form`,async({page},info)=>{
  await page.setViewportSize({width:1600,height:1000})
  const writes=await open(page)
  await expect(page.getByRole('button',{name:'新增账单',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'导出',exact:true})).toBeVisible()
  const download=page.waitForEvent('download')
  await page.getByRole('button',{name:'导出',exact:true}).click()
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/)
  const chooser=page.waitForEvent('filechooser')
  await page.getByRole('button',{name:'导入 Excel',exact:true}).click()
  await chooser
  if(context==='selected channel')await page.getByLabel('筛选明细渠道').selectOption('vivo天鑫')
  else await page.getByLabel('搜索渠道账单').fill('vivo')
  await page.screenshot({path:info.outputPath('channel-native-controls.png')})
  await page.getByRole('button',{name:'新增账单',exact:true}).click()
  await expect(page.getByTestId('route')).toHaveText('channel-recon-create')
  await expect(page.getByRole('combobox',{name:'搜索客户库合作方'})).toHaveValue('维沃移动通信有限公司')
  await expect(page.getByTestId('prefill')).toContainText('vivo-1')
  await page.screenshot({path:info.outputPath('channel-create-context.png')})
  expect(writes).toEqual([])
})

}

test('real RD page keeps native controls and opens actual new bill form',async({page},info)=>{
  await page.setViewportSize({width:1600,height:1000})
  const writes=await open(page,'recon-rd')
  await expect(page.getByRole('button',{name:'新增账单',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'导出',exact:true})).toBeVisible()
  const download=page.waitForEvent('download')
  await page.getByRole('button',{name:'导出',exact:true}).click()
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/)
  const chooser=page.waitForEvent('filechooser')
  await page.getByRole('button',{name:'导入 Excel',exact:true}).click()
  await chooser
  await page.screenshot({path:info.outputPath('rd-native-controls.png')})
  await page.getByRole('button',{name:'新增账单',exact:true}).click()
  await expect(page.getByTestId('route')).toHaveText('recon-create')
  await expect(page.locator('#core-rd-bill-form')).toBeVisible()
  await page.screenshot({path:info.outputPath('rd-create-form.png')})
  expect(writes).toEqual([])
})

test('mobile group expands without dismissing menu, destinations and system management work',async({page},info)=>{
  await page.setViewportSize({width:390,height:844})
  const writes=await open(page,'dashboard')
  await page.getByRole('button',{name:'打开菜单',exact:true}).click()
  const menu=page.getByRole('dialog',{name:'系统导航'})
  await menu.getByRole('button',{name:'对账中心',exact:true}).click()
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('button',{name:'渠道账单',exact:true})).toBeVisible()
  await page.screenshot({path:info.outputPath('mobile-expanded-navigation.png')})
  await menu.getByRole('button',{name:'渠道账单',exact:true}).click()
  await expect(menu).not.toBeVisible()
  await expect(page.getByTestId('route')).toHaveText('recon-channel')
  await page.getByRole('button',{name:'打开菜单',exact:true}).click()
  await menu.getByRole('button',{name:'系统管理',exact:true}).click()
  await expect(menu).not.toBeVisible()
  await expect(page.getByTestId('route')).toHaveText('user-center')
  await expect(page.locator('.user-v24-page')).toBeVisible()
  expect(writes).toEqual([])
})
