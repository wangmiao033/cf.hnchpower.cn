import {test,expect} from '@playwright/test'
import * as XLSX from 'xlsx'

const fixture='/tests/fixtures/daxiong-responsive.html'
const lines=[
  '订单号,游戏名称,游戏ID,实付金额,支付时间,支付状态,订单类型',
  'DX001,帝国雄师,893,100.01,2026-09-01,支付成功,游戏充值',
  'DX002,帝国雄师,893,0.02,2026-09-02,已完成,游戏充值',
  'DX003,大熊竹币,0,50.00,2026-09-03,成功,竹B充值',
  'DX004,帝国雄师,893,12.00,2026-09-04,待支付,游戏充值',
  'DX002,帝国雄师,893,0.02,2026-09-02,已完成,游戏充值'
]
function csvPayload(content=lines.join('\n')) {
  return {name:'daxiong-september.csv',mimeType:'text/csv',buffer:Buffer.from('\uFEFF'+content,'utf-8')}
}
async function openPage(page) {
  const writes=[]
  await page.route(url=>url.pathname.startsWith('/api/'),route=>{
    const req=route.request()
    if(!['GET','HEAD'].includes(req.method()))writes.push(req.method()+' '+new URL(req.url()).pathname)
    if(new URL(req.url()).pathname==='/api/auth/me'){
      return route.fulfill({json:{id:'admin-import-test',role:'admin',display_name:'导入核对测试',permissions:[]}})
    }
    return route.fulfill({json:{items:[],permissions:[],roles:[]}})
  })
  await page.goto(fixture)
  await expect(page.getByRole('button',{name:'导入订单 · 先核对'})).toBeVisible()
  return writes
}

test('CSV local read validates paid vs pending, dedup and coin cash separately without server writes',async({page})=>{
  await page.setViewportSize({width:1366,height:900})
  const writes=await openPage(page)
  await page.getByRole('button',{name:'导入订单 · 先核对'}).click()
  const dialog=page.getByRole('dialog',{name:'大熊游戏订单导入预览'})
  await expect(dialog).toBeVisible()
  await dialog.locator('#so-import-file').setInputFiles(csvPayload())
  await expect(dialog.getByText('daxiong-september.csv').first()).toBeVisible()
  await expect(dialog.getByText('¥100.03')).toBeVisible()
  await expect(dialog.getByText('¥50.00').first()).toBeVisible()
  await expect(dialog.getByText('文件内重复：1')).toBeVisible()
  await expect(dialog.getByText('未支付/退款等排除：1')).toBeVisible()
  await dialog.getByRole('button',{name:'在页面查看有效订单（不保存）'}).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('已加载文件（未保存）')).toBeVisible()
  await expect(page.locator('.so-metric').first()).toContainText('¥100.03')
  await expect(page.locator('.so-metric').nth(1)).toContainText('¥50.00')
  await expect(page.locator('.so-game-table tbody tr')).toHaveCount(1)
  await page.getByRole('tab',{name:'买量管理'}).click()
  await expect(page.getByText('真实买量数据未接入')).toBeVisible()
  expect(writes).toEqual([])
  await page.reload()
  await expect(page.getByText('已加载文件（未保存）')).toHaveCount(0)
  await expect(page.locator('.so-metric').first()).toContainText('¥2.49万')
})

test('Excel import supports multiple sheets and chooses matching order sheet',async({page})=>{
  const writes=await openPage(page)
  const wb=XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['使用说明'],['其他内容']]),'说明')
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ['订单号','游戏名称','游戏ID','实付金额','支付时间','订单状态','业务类型'],
    ['X001','雷鸣三国','124',200.01,'2026-08-16','成功','游戏充值'],
    ['X002','大熊竹币','0',3.05,'2026-08-17','已支付','竹币充值']
  ]),'订单明细')
  const data=XLSX.write(wb,{type:'buffer',bookType:'xlsx'})
  await page.getByRole('button',{name:'导入订单 · 先核对'}).click()
  const dialog=page.getByRole('dialog',{name:'大熊游戏订单导入预览'})
  await dialog.locator('#so-import-file').setInputFiles({name:'august.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(data)})
  await expect(dialog.getByRole('combobox',{name:'选择工作表'})).toHaveValue('0')
  await expect(dialog.getByText('¥200.01').first()).toBeVisible()
  await expect(dialog.getByText('¥3.05').first()).toBeVisible()
  await dialog.getByRole('button',{name:'在页面查看有效订单（不保存）'}).click()
  await expect(page.getByLabel('账期')).toHaveValue('2026-08')
  await expect(page.locator('.so-metric').first()).toContainText('¥200.01')
  expect(writes).toEqual([])
})

test('manual column mapping and invalid dates prevent unsafe accounting',async({page})=>{
  const writes=await openPage(page)
  await page.getByRole('button',{name:'导入订单 · 先核对'}).click()
  const dialog=page.getByRole('dialog',{name:'大熊游戏订单导入预览'})
  await dialog.locator('#so-import-file').setInputFiles(csvPayload([
    '外部凭证,产品名,金额,日期',
    'ZZ001,帝国雄师,80.00,2026-02-30',
    'ZZ002,帝国雄师,20.01,2026-09-06'
  ].join('\n')))
  await expect(dialog.getByText('字段还未匹配完整：订单编号')).toBeVisible()
  await expect(dialog.getByRole('button',{name:'在页面查看有效订单（不保存）'})).toBeDisabled()
  await dialog.getByRole('combobox',{name:'对应字段：订单编号'}).selectOption('0')
  await expect(dialog.getByText('字段错误：1')).toBeVisible()
  await expect(dialog.getByText('¥20.01').first()).toBeVisible()
  await dialog.getByRole('button',{name:'在页面查看有效订单（不保存）'}).click()
  await expect(page.locator('.so-metric').first()).toContainText('¥20.01')
  expect(writes).toEqual([])
})

test('invalid file is rejected without changing existing demo summary',async({page})=>{
  const writes=await openPage(page)
  await page.getByRole('button',{name:'导入订单 · 先核对'}).click()
  const dialog=page.getByRole('dialog',{name:'大熊游戏订单导入预览'})
  await dialog.locator('#so-import-file').setInputFiles({name:'payments.exe',mimeType:'application/octet-stream',buffer:Buffer.from('nothing')})
  await expect(dialog.getByRole('alert')).toContainText('仅支持')
  await expect(dialog.getByRole('button',{name:'在页面查看有效订单（不保存）'})).toBeDisabled()
  await dialog.getByRole('button',{name:'取消'}).click()
  await expect(page.locator('.so-metric').first()).toContainText('¥2.49万')
  expect(writes).toEqual([])
})
