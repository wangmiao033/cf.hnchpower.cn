import {test,expect} from '@playwright/test'
const fixture='/tests/fixtures/daxiong-ledger.html'
async function setup(page,{ready=true,fail=false}={}){
 page.on('pageerror',error=>console.log('PAGE ERROR:',error.message))
 let saved=[],revision=0;const requests=[]
 await page.route(url=>url.pathname.startsWith('/api/'),async route=>{
  const request=route.request(),path=new URL(request.url()).pathname
  if(path==='/api/auth/me')return route.fulfill({json:{id:'ledger-admin',role:'admin',permissions:[]}})
  if(path.endsWith('/rd-options'))return route.fulfill({json:[]})
  if(path.includes('/self-operated/ledger/')){
   if(request.method()==='POST'){
    const body=request.postDataJSON();requests.push(body)
    if(fail&&requests.length===1)return route.fulfill({status:500,json:{detail:'simulated failure'}})
    saved=body.rows;revision++;return route.fulfill({json:{revision,replayed:false}})
   }
   return route.fulfill({json:{rows:saved.map(r=>({...r,rd_options:[],imported:false})),revision,schema_ready:ready,write_ready:ready}})
  }
  return route.fulfill({json:{items:[]}})
 })
 await page.goto(fixture)
 await expect(page.getByText('本月尚无记录')).toBeVisible()
 return requests
}
test('server save preserves unknown amounts and reloads, failed retry has same key',async({page})=>{
 const requests=await setup(page,{fail:true})
 await page.getByRole('button',{name:'添加游戏'}).click()
 await page.getByLabel('游戏 1',{exact:true}).fill('真实游戏')
 await page.getByLabel('现金实付 1').fill('100.01')
 await page.getByLabel('实际到账 1').fill('80.02')
 await page.getByRole('button',{name:'保存月表'}).click()
 await expect(page.getByRole('alert')).toContainText('保存未确认')
 await expect(page.getByLabel('现金实付 1')).toHaveValue('100.01')
 await page.getByRole('button',{name:'保存月表'}).click()
 await expect(page.getByText('已保存到服务器',{exact:true})).toBeVisible()
 expect(requests[0]).toEqual(requests[1])
 expect(requests[1].rows[0]).toMatchObject({cash_cents:10001,received_cents:8002,refund_cents:null,fee_cents:null})
 await page.reload()
 await expect(page.getByLabel('实际到账 1')).toHaveValue('80.02')
 await expect(page.getByLabel('退款 1')).toHaveValue('')
})
test('migration gate shows honest unavailable state without demo',async({page})=>{
 const requests=await setup(page,{ready:false})
 await expect(page.getByRole('button',{name:'保存月表'})).toBeDisabled()
 await expect(page.getByText(/正式存储尚未启用/)).toBeVisible()
 expect(requests).toHaveLength(0)
})
test('existing device draft requires preview and confirmation and is retained',async({page})=>{
 await setup(page)
 const imports=[]
 await page.route('**/api/self-operated/imports/confirm',route=>{imports.push(route.request().postDataJSON());return route.fulfill({json:{inserted:1,skipped_existing:0}})})
 await page.evaluate(async()=>{
  const {inspectOrderRows}=await import('/src/domain/selfOperated/orderPreviewImport.js')
  const {saveLocalDraft}=await import('/src/domain/selfOperated/deviceDraft.js')
  const parsed=inspectOrderRows([['订单号','游戏名称','游戏ID','实付金额','支付时间','支付状态','订单类型'],['LOCAL001','草稿游戏','111','10.01','2026-09-01','支付成功','游戏充值']])
  await saveLocalDraft('ledger-admin',{...parsed,draftId:crypto.randomUUID(),fileName:'real-draft.csv'})
 })
 await page.reload()
 await page.getByRole('button',{name:'查看本机草稿（未迁入）'}).click()
 expect(imports).toHaveLength(0)
 await page.getByText('查看逐月游戏金额').click()
 await expect(page.getByText('草稿游戏 · 10.01')).toBeVisible()
 await expect(page.getByRole('button',{name:'确认导入服务器'})).toBeDisabled()
 await page.getByRole('checkbox').check()
 await page.getByRole('button',{name:'确认导入服务器'}).click()
 await expect(page.getByText(/服务器已确认导入 1 条/)).toBeVisible()
 expect(imports).toHaveLength(1)
 const retained=await page.evaluate(async()=>{const {loadLocalDraft}=await import('/src/domain/selfOperated/deviceDraft.js');return (await loadLocalDraft('ledger-admin'))?.payload?.fileName})
 expect(retained).toBe('real-draft.csv')
})
for(const width of [390,1366])test(`formal table renders ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await setup(page)
 await page.getByRole('button',{name:'添加游戏'}).click()
 await expect(page.locator('th')).toHaveText(['游戏','现金实付','退款','手续费','实际到账','研发应付','核对状态'])
 await page.screenshot({path:info.outputPath('ledger.png'),fullPage:true})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(2)
})
