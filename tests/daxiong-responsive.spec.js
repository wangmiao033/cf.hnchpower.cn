import { test, expect } from '@playwright/test'

async function openReadOnly(page) {
 const writes=[]
 await page.route(url=>url.pathname.startsWith('/api/'),route=>{
  if(!['GET','HEAD'].includes(route.request().method())) writes.push(route.request().method())
  return route.fulfill({json:new URL(route.request().url()).pathname==='/api/auth/me'?{id:'layout-admin',role:'admin',permissions:[]}:{items:[]}})
 })
 await page.goto('/tests/fixtures/daxiong-responsive.html')
 await expect(page.getByRole('heading',{name:'月度表'})).toBeVisible()
 return writes
}
for(const width of [1920,1366,1024,768,390,320]){
 test(`monthly table stays inside the system shell at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:900})
  const writes=await openReadOnly(page)
  await expect(page.locator('.so-game-table th')).toHaveText(['游戏','现金实付','退款','手续费','实际到账','研发应付','核对状态'])
  await expect(page.locator('.so-game-table tbody tr')).toHaveCount(6)
  await expect(page.locator('.so-tabs,.so-aside,.so-metrics')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'核对保存',exact:true})).toBeDisabled()
  const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth-innerWidth,page:document.querySelector('.so-page').scrollWidth-document.querySelector('.so-page').clientWidth}))
  expect(overflow.document).toBeLessThanOrEqual(2)
  expect(overflow.page).toBeLessThanOrEqual(2)
  expect(writes).toEqual([])
  await page.screenshot({path:info.outputPath(`monthly-${width}.png`),fullPage:true})
 })
}
test('month survives resizing and unknown amounts remain unknown',async({page})=>{
 const writes=await openReadOnly(page)
 await page.getByLabel('账期').selectOption('2026-08')
 await expect(page.locator('.so-cash-total')).toHaveText('¥16,500.20')
 await page.setViewportSize({width:390,height:844})
 await expect(page.getByLabel('账期')).toHaveValue('2026-08')
 await expect(page.locator('.so-game-table tbody td').filter({hasText:/^未录入$/})).toHaveCount(24)
 expect(writes).toEqual([])
})
