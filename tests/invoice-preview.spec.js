import {test,expect} from '@playwright/test'
async function open(page,{stale=false,fail=false}={}) {
 const writes=[],reads={}
 await page.route(url=>url.pathname.startsWith('/api/'),route=>{
  const request=route.request(),path=new URL(request.url()).pathname
  if(request.method()==='POST') { writes.push(request.postDataJSON());return route.fulfill({status:fail?500:201,json:fail?{detail:'failed'}:{}}) }
  const id=path.split('/').pop(),n=id.slice(1);reads[id]=(reads[id]||0)+1
  return route.fulfill({json:{invoice_amount:106,remaining_amount:106,candidates:stale&&reads[id]>1?[]:[{bill:{bill_type:'channel',bill_id:`b${n}`,partner_name:'测试渠道公司',number:`QD-00${n}`,game_name:'仙帝神兵',settlement_month:'2026-08',gross_amount:106},available_amount:106}]}})
 })
 await page.goto('/tests/fixtures/invoice-preview.html')
 await expect(page.getByRole('checkbox',{name:'选择匹配 20260900000000000001'})).toBeEnabled()
 await expect(page.getByRole('checkbox',{name:'选择匹配 20260900000000000002'})).toBeEnabled()
 return writes
}
test('preview explains targets and submits only the reviewed selection',async({page})=>{
 const writes=await open(page)
 await expect(page.getByRole('button',{name:'确认所选 0 张'})).toBeDisabled()
 await expect(page.locator('.invoice-preview-item').first()).toContainText('QD-001')
 await expect(page.locator('.invoice-preview-item').first()).toContainText('2026-08')
 await expect(page.locator('.invoice-preview-item').first()).toContainText('仙帝神兵')
 await expect(page.locator('.invoice-preview-item').first()).toContainText('次月开票')
 expect(writes).toEqual([])
 await page.getByRole('checkbox',{name:'选择匹配 20260900000000000002'}).check()
 await page.getByRole('button',{name:'确认所选 1 张'}).click()
 await expect(page.locator('footer')).toContainText('已按预览关联 1 张')
 expect(writes).toHaveLength(1)
 expect(writes[0]).toMatchObject({invoice_id:'i2',bill_id:'b2',allocated_gross_amount:106})
 await expect(page.getByRole('button',{name:'确认所选 1 张'})).toBeDisabled()
})
test('changed target stops without substituting another bill',async({page})=>{
 const writes=await open(page,{stale:true})
 await page.getByRole('checkbox',{name:'全选已加载且可关联的建议'}).check()
 await page.getByRole('button',{name:'确认所选 2 张'}).click()
 await expect(page.locator('footer')).toContainText('后续未执行')
 expect(writes).toEqual([])
})
test('uncertain failure stops remaining writes and disables repeat submission',async({page})=>{
 const writes=await open(page,{fail:true})
 await page.getByRole('checkbox',{name:'全选已加载且可关联的建议'}).check()
 await page.getByRole('button',{name:'确认所选 2 张'}).click()
 await expect(page.locator('footer')).toContainText('后续未执行')
 expect(writes).toHaveLength(1)
 await expect(page.getByRole('button',{name:'确认所选 2 张'})).toBeDisabled()
})
for(const width of [1440,390]) test(`preview layout ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});await open(page)
 const box=await page.getByRole('dialog').boundingBox();expect(box.x+box.width).toBeLessThanOrEqual(width)
 await expect(page.getByRole('button',{name:'确认所选 0 张'})).toBeInViewport()
 await page.screenshot({path:info.outputPath('preview.png'),fullPage:true})
})
