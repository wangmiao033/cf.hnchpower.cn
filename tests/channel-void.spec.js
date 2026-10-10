import { test, expect } from '@playwright/test'

async function open(page, fail = false) {
  const writes = []
  await page.addInitScript(() => { window.prompt = () => { throw new Error('Native prompt is unavailable') } })
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/transition')) {
      writes.push({path, body: route.request().postDataJSON()})
      return route.fulfill(fail ? {status:409, json:{detail:{message:'已有收款，不能作废'}}} : {json:{status:'cancelled'}})
    }
    if (path === '/api/bill-lifecycle/archive') return route.fulfill({json:{archived_ids:['archived'], eligible_ids:[], items:[]}})
    if (path === '/api/auth/me') return route.fulfill({json:{role:'admin', permissions:[]}})
    return route.abort()
  })
  page.on('pageerror', error => { throw error })
  await page.goto('/tests/fixtures/channel-detail.html')
  await expect(page.locator('.channel-flat-ledger tbody tr')).toHaveCount(28)
  return writes
}

test('void uses an in-page reason dialog when native prompts are unavailable', async ({page}) => {
  const writes = await open(page)
  await page.getByRole('button', {name:'作废',exact:true}).first().click()
  const dialog = page.getByRole('alertdialog', {name:'作废渠道账单'})
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('¥ 100.00')
  await dialog.getByRole('button', {name:'取消',exact:true}).click()
  expect(writes).toEqual([])
  await page.getByRole('button', {name:'作废',exact:true}).first().click()
  await dialog.getByRole('button', {name:'确认作废',exact:true}).click()
  await expect(dialog.getByRole('alert')).toHaveText('请填写作废原因')
  expect(writes).toEqual([])
  await page.getByLabel('作废原因（必填）').fill('  重复录入  ')
  await dialog.getByRole('button', {name:'确认作废',exact:true}).click()
  await expect(dialog).not.toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0].body).toEqual({to_status:'cancelled',reason:'重复录入'})
})

test('backend refusal remains visible with the reason preserved on mobile', async ({page}) => {
  await page.setViewportSize({width:390,height:844})
  const writes = await open(page,true)
  await page.getByRole('button', {name:'作废',exact:true}).first().click()
  const dialog = page.getByRole('alertdialog', {name:'作废渠道账单'})
  await page.getByLabel('作废原因（必填）').fill('重复录入')
  await dialog.getByRole('button', {name:'确认作废',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('已有收款，不能作废')
  await expect(page.getByLabel('作废原因（必填）')).toHaveValue('重复录入')
  expect(writes).toHaveLength(1)
  const box = await dialog.boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
})

test('bulk retry only includes failed bills', async ({page}) => {
  const writes = await open(page)
  let fail = true
  await page.route('**/api/bill-lifecycle/channel/*/transition', route => {
    const path = new URL(route.request().url()).pathname
    writes.push({path,body:route.request().postDataJSON()})
    const reject = fail && writes.length === 2
    return route.fulfill(reject ? {status:409,json:{detail:{message:'关联检查失败'}}} : {json:{status:'cancelled'}})
  })
  await page.getByRole('tab',{name:'按渠道汇总',exact:true}).click()
  await page.getByRole('button',{name:'展开全部',exact:true}).click()
  await page.getByRole('checkbox',{name:/选择渠道账单/}).nth(0).check()
  await page.getByRole('checkbox',{name:/选择渠道账单/}).nth(1).check()
  await page.getByRole('button',{name:'作废所选（2）',exact:true}).click()
  const dialog = page.getByRole('alertdialog',{name:'作废渠道账单'})
  await page.getByLabel('作废原因（必填）').fill('重复录入')
  await dialog.getByRole('button',{name:'确认作废',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('关联检查失败')
  expect(writes).toHaveLength(2)
  fail = false
  await dialog.getByRole('button',{name:'确认作废',exact:true}).click()
  await expect(dialog).not.toBeVisible()
  expect(writes).toHaveLength(3)
  expect(writes[2].path).toBe(writes[1].path)
})
