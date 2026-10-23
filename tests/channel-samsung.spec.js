import { test, expect } from '@playwright/test'
const code='samsung_statement_fee'
async function setup(page,other=false,alias=false){
 const requests=[]
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname
  if(!path.startsWith('/api/'))return route.continue()
  if(path==='/api/contract-terms/channel-rule-recommendation'){
   const body=route.request().postDataJSON();requests.push(body)
   const rule={share_rate:50,tax_rate:6,channel_fee_rate:5,channel_fee_mode:'percent',tax_mode:'none',settlement_rule_code:'five_percent_gateway_share'}
   return route.fulfill({json:{auto_apply:true,header_recommendation:rule,partner_rule_status:'ready',lines:body.lines.map(row=>({...row,auto_apply:true,match:{access_item_id:'synthetic-contract'},recommended:rule}))}})
  }
  return route.abort()
 })
 await page.goto('/tests/fixtures/channel-samsung.html'+(other?'?other=1':alias?'?alias=1':''))
 await expect(page.locator('.channel-contract-rule-status')).toContainText('已按当前游戏和账期自动套用')
 return requests
}
for(const width of [1440,390])test(`Samsung explicit fee save and reopen survives contract refill at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000})
 const requests=await setup(page,false,width===390)
 await expect(page.getByTestId('current')).toContainText('"systemSettlementAmount":354.83')
 await page.getByRole('combobox',{name:'规则模板',exact:true}).selectOption(code)
 await page.getByLabel('第1行原账单通道费金额').fill('21.08')
 await page.getByLabel('第2行原账单通道费金额').fill('8.60')
 await expect.poll(async()=>JSON.parse(await page.getByTestId('current').textContent()).systemSettlementAmount).toBe(358.66)
 await page.getByRole('button',{name:'测试保存',exact:true}).click()
 await expect.poll(async()=>JSON.parse(await page.getByTestId('saved').textContent()).items.map(x=>[x.gateway_cost,x.settlement_rule_code,x.tax_mode])).toEqual([[21.08,code,'none'],[8.6,code,'none']])
 const previous=requests.length
 await page.getByRole('button',{name:'测试重新打开'}).click()
 await expect.poll(()=>requests.length).toBeGreaterThan(previous)
 await expect(page.getByLabel('第1行原账单通道费金额')).toHaveValue('21.08')
 await expect.poll(async()=>JSON.parse(await page.getByTestId('current').textContent()).systemSettlementAmount).toBe(358.66)
 await expect(page.getByRole('combobox',{name:'规则模板',exact:true})).toBeDisabled()
 await page.locator('#bill').screenshot({path:`test-results/samsung-${width}.png`})
})
test('non-Samsung never sees the option and keeps the 5% contract calculation',async({page})=>{
 await setup(page,true)
 await expect(page.locator(`option[value="${code}"]`)).toHaveCount(0)
 await expect(page.getByTestId('current')).toContainText('"systemSettlementAmount":354.83')
 await expect(page.getByLabel('第1行原账单通道费金额')).toHaveCount(0)
})
test('missing statement fee does not become zero on save',async({page})=>{
 await setup(page)
 await page.getByRole('combobox',{name:'规则模板',exact:true}).selectOption(code)
 await page.getByRole('button',{name:'测试保存',exact:true}).click()
 await expect(page.getByTestId('saved')).toHaveText('null')
 await expect(page.getByLabel('第1行原账单通道费金额')).toHaveValue('')
})
test('enabled Samsung rule protects identity without crashing the form',async({page})=>{
 await setup(page)
 await page.getByRole('combobox',{name:'规则模板',exact:true}).selectOption(code)
 await page.getByRole('combobox',{name:'搜索客户库合作方'}).fill('其他公司')
 await expect(page.getByRole('alert')).toContainText('请保留合作方身份')
 await expect(page.getByRole('combobox',{name:'搜索客户库合作方'})).toHaveValue('北京鹏泰博兴科技有限公司')
 await expect(page.getByLabel('第1行原账单通道费金额')).toBeVisible()
})
