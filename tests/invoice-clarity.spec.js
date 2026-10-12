import { test, expect } from '@playwright/test'
const candidate = { bill:{ bill_id:'b1', bill_type:'channel', number:'QD-TEST-01', partner_name:'测试渠道公司', settlement_month:'2026-08', game_name:'仙帝神兵', status:'已核对' }, available_amount:106, suggested_amount:106, match_score:0.9, match_reasons:['往来单位一致','金额一致'] }
async function open(page) {
 const writes=[]
 await page.route(url => url.pathname.startsWith('/api/'), route=> {
  if(route.request().method()!=='GET') { writes.push(route.request().postDataJSON()); return route.fulfill({json:{}}) }
  return route.fulfill({json:{invoice_amount:106,allocated_amount:0,remaining_amount:106,coverage_status:'none',coverage_percent:0,allocations:[],candidates:[candidate]}})
 })
 await page.goto('/tests/fixtures/invoice-clarity.html')
 await expect(page.getByRole('button',{name:'确认关联'})).toBeVisible()
 return writes
}
test('matching facts, search and explicit amount submission stay correct',async({page})=>{
 const writes=await open(page)
 await expect(page.locator('.invoice-match-facts')).toContainText('仙帝神兵')
 await expect(page.locator('.invoice-match-facts')).toContainText('2026-08')
 await page.getByRole('searchbox',{name:'搜索可关联账单'}).fill('不存在')
 await expect(page.getByText('没有匹配的账单',{exact:true})).toBeVisible()
 expect(writes).toEqual([])
 await page.getByRole('searchbox',{name:'搜索可关联账单'}).fill('仙帝神兵')
 await page.getByRole('spinbutton',{name:'关联金额：QD-TEST-01'}).fill('50')
 await page.getByRole('button',{name:'确认关联'}).click()
 await expect.poll(()=>writes.length).toBe(1)
 expect(writes[0]).toMatchObject({bill_id:'b1',invoice_id:'test-invoice',allocated_gross_amount:50})
})
for(const width of [1440,390]) test(`matching layout readable at ${width}`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:1000}); await open(page)
 const fonts=await page.locator('.invoice-match-facts strong, .invoice-bill-card__link input').evaluateAll(els=>els.map(el=>getComputedStyle(el).fontFamily))
 expect(new Set(fonts).size).toBe(1)
 const box=await page.locator('.invoice-bill-card--candidate').boundingBox()
 expect(box.x+box.width).toBeLessThanOrEqual(width+1)
 await page.getByRole('button',{name:'确认关联'}).scrollIntoViewIfNeeded()
 await expect(page.getByRole('button',{name:'确认关联'})).toBeInViewport()
 await page.screenshot({path:testInfo.outputPath(`invoice-${width}.png`),fullPage:true})
})
