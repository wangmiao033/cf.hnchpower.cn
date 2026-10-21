import { test, expect } from '@playwright/test'

async function setup(page, options = {}) {
  let record = {
    id: 'UI-REVIEW', partner_name: '测试渠道', channel_name: '测试渠道', settlement_month: '2026-09',
    status: 'pending', updated_at: '2026-10-20T00:00:00Z', settlement_amount: 100,
    billing_flow: 100, share_rate: 100, tax_rate: 0, system_settlement_amount: 100,
    validation_status: 'pass', platform_settlement_amount:100, settlement_difference:0, remark: '保留测试备注',
    items: [{id:'test-line',game_name:'测试游戏',settlement_cycle:'2026-09',billing_flow:100,
      discount_factor:1,share_rate:100,tax_rate:0,settlement_amount:100,system_settlement_amount:100,platform_settlement_amount:100,settlement_difference:0,validation_status:'pass'}]
  }
  let recordReads = 0
  const transitions = []
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    // Module paths such as /src/lib/api/channel.ts are source, not requests.
    if (!path.startsWith('/api/')) return route.continue()
    if (path === '/api/auth/me') return route.fulfill({json:{id:'test',role:'admin',permissions:[]}})
    if (path === '/api/channel-records/UI-REVIEW') {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON()
        expect(body.expected_updated_at).toBe(record.updated_at)
        record = {...record, remark:body.remark, updated_at:'2026-10-21T01:00:00Z'}
        return route.fulfill({json:record})
      }
      recordReads++
      if (options.failReload && recordReads > 2) return route.fulfill({status:500,json:{detail:'测试刷新失败'}})
      if (options.onRead) await options.onRead(recordReads)
      return route.fulfill({json:{...record, ...(recordReads > 1 ? options.serverChange : {})}})
    }
    if (path.endsWith('/transition')) {
      transitions.push(route.request().postDataJSON())
      if (options.failTransition) return route.fulfill({status:500,json:{detail:'测试核对失败'}})
      return route.fulfill({json:{bill_id:record.id,status:'confirmed'}})
    }
    if (path === '/api/contract-terms/reconcile-v3') return route.fulfill({json:{summary:{fail_count:0},items:[]}})
    // No fixture request can reach a real API, including unknown future endpoints.
    return route.fulfill({status:404,json:{detail:'isolated UI fixture'}})
  })
  await page.goto('/tests/fixtures/channel-review-page.html')
  await expect(page.locator('#core-channel-bill-form')).toBeVisible()
  return { transitions, reads:()=>recordReads, changeServer:change=>{record={...record,...change}} }
}
async function startReview(page) {
  await page.locator('.core-bill-footer .confirm-review').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', {name:/开始核对/}).click()
}

test('actual page cancel preserves input and sends no save or transition', async ({page}) => {
  const {transitions} = await setup(page)
  const trigger = page.locator('.core-bill-footer .confirm-review')
  await trigger.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', {name:'返回检查'})).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(trigger).toBeFocused()
  expect(await page.evaluate(() => window.reviewTest.saves)).toEqual([])
  expect(transitions).toEqual([])
})

test('actual page saves dirty input once and distinguishes saved-but-not-confirmed', async ({page}) => {
  const {transitions} = await setup(page, {failTransition:true})
  await page.getByRole('button', {name:/备注 \/ 特殊说明/}).click()
  await page.locator('#channel-bill-last-remarks').fill('新的测试备注，失败后保留')
  await startReview(page)
  await expect(page.getByRole('alert')).toContainText('修改已保存，但核对未完成')
  expect(await page.evaluate(() => window.reviewTest.saves.length)).toBe(1)
  expect(transitions).toHaveLength(1)
  await expect(page.locator('#channel-bill-last-remarks')).toHaveValue('新的测试备注，失败后保留')
  expect(await page.evaluate(() => window.reviewTest.navigations)).toEqual([])
})

test('actual page never relabels a successful confirmation as failed on refresh error', async ({page}) => {
  const {transitions} = await setup(page)
  await page.evaluate(() => { window.reviewTest.failRefresh = true })
  await startReview(page)
  await expect(page.getByRole('alert')).toContainText('核对已成功')
  await expect(page.getByRole('button', {name:'重新读取账单状态'})).toBeVisible()
  await expect(page.getByRole('button', {name:'重新检测合同'})).toHaveCount(0)
  expect(transitions).toHaveLength(1)
  expect(await page.evaluate(() => window.reviewTest.toasts.some(t => t.tone === 'success'))).toBe(false)
})

test('actual page blocks a stale server revision before saving or confirming', async ({page}) => {
  const {transitions,reads} = await setup(page, {serverChange:{updated_at:'2026-10-21T00:00:00Z'}})
  await startReview(page)
  await expect.poll(reads).toBeGreaterThanOrEqual(3)
  await expect(page.locator('#core-channel-bill-form')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('内容与服务器一致', {exact:true})).toBeVisible()
  expect(transitions).toEqual([])
  expect(await page.evaluate(() => window.reviewTest.saves)).toEqual([])
})

test('leaving during preflight prevents late save, confirmation and navigation', async ({page}) => {
  let release
  const gate = new Promise(resolve => {release=resolve})
  const {transitions} = await setup(page, {onRead: n => n === 2 ? gate : undefined})
  await startReview(page)
  await expect(page.getByRole('status').filter({hasText:'正在检查服务器状态'})).toBeVisible()
  await page.evaluate(() => window.unmountReviewPage())
  release()
  await expect(page.getByText('已离开账单')).toBeVisible()
  await page.waitForTimeout(200)
  expect(transitions).toEqual([])
  expect(await page.evaluate(() => window.reviewTest.saves)).toEqual([])
  expect(await page.evaluate(() => window.reviewTest.navigations)).toEqual([])
})

test('save failure keeps current input and never starts a lifecycle transition', async ({page}) => {
  const {transitions} = await setup(page)
  await page.evaluate(() => { window.reviewTest.failSave = true })
  await page.getByRole('button', {name:/备注 \/ 特殊说明/}).click()
  await page.locator('#channel-bill-last-remarks').fill('失败后仍可修正的测试输入')
  await startReview(page)
  await expect(page.getByRole('alert')).toContainText('保存 / 核对未完成')
  await expect(page.locator('#channel-bill-last-remarks')).toHaveValue('失败后仍可修正的测试输入')
  await expect(page.locator('.core-bill-footer .confirm-review')).toBeEnabled()
  expect(transitions).toEqual([])
  expect(await page.evaluate(() => window.reviewTest.saves.length)).toBe(1)
})


test('own successful save advances baseline so a failed confirmation can retry without self-conflict', async ({page}) => {
  const {transitions} = await setup(page, {failTransition:true})
  await page.getByRole('button', {name:/备注 \/ 特殊说明/}).click()
  await page.locator('#channel-bill-last-remarks').fill('已保存的本机修改')
  await startReview(page)
  await expect(page.getByRole('alert')).toContainText('修改已保存，但核对未完成')
  await startReview(page)
  await expect.poll(() => transitions.length).toBe(2)
  await expect(page.getByRole('alert')).not.toContainText('服务器版本已变化')
  expect(await page.evaluate(() => window.reviewTest.saves.length)).toBe(1)
  await expect(page.locator('#channel-bill-last-remarks')).toHaveValue('已保存的本机修改')
})

test('failed reload retains the conflict and never falsely claims refresh success', async ({page}) => {
  const {transitions} = await setup(page, {serverChange:{updated_at:'2026-10-21T00:00:00Z'},failReload:true})
  await startReview(page)
  await expect(page.getByRole('heading', {name:'无法打开渠道账单'})).toBeVisible()
  expect(transitions).toEqual([])
  expect(await page.evaluate(() => window.reviewTest.toasts.some(t => t.message.includes('已重新读取服务器版本')))).toBe(false)
})


test('a genuinely newer edit after our save still blocks the next confirmation', async ({page}) => {
  const {transitions,reads,changeServer} = await setup(page, {failTransition:true})
  await page.getByRole('button', {name:/备注 \/ 特殊说明/}).click()
  await page.locator('#channel-bill-last-remarks').fill('本次已保存备注')
  await startReview(page)
  await expect(page.getByRole('alert')).toContainText('修改已保存，但核对未完成')
  const before = reads()
  changeServer({updated_at:'2026-10-21T02:00:00Z',remark:'其它页面的修改'})
  await startReview(page)
  await expect.poll(reads).toBeGreaterThanOrEqual(before + 2)
  await expect(page.locator('#core-channel-bill-form')).toBeVisible()
  expect(transitions).toHaveLength(1)
  expect(await page.evaluate(() => window.reviewTest.saves.length)).toBe(1)
})
