import { test, expect } from '@playwright/test'

// Entire API is isolated. These tests exercise the real page/API client but do
// not represent production data, a database commit, or a real financial review.
async function setup(page, options = {}) {
  const month = options.record?.settlement_month || '2026-07'
  const record = {
    id:'UI-REVIEW',statement_no:'QD-20261015-041F2B',partner_name:'四三九九网络股份有限公司',channel_name:'4399',
    settlement_month:month,status:'pending',updated_at:'2026-10-22T00:00:00Z',
    settlement_amount:144.4,system_settlement_amount:135.85,platform_settlement_amount:144.4,
    settlement_difference:-8.55,validation_status:'fail',billing_flow:135.85,share_rate:100,
    settlement_rule_code:'share_only',channel_fee_mode:'none',tax_mode:'none',tax_rate:0,
    received_amount:50,receipt_status:'partial',remark:'原始备注不改',
    items:[{id:'J1',game_name:'测试游戏',settlement_cycle:month,billing_flow:135.85,
      discount_factor:1,share_rate:100,tax_rate:0,settlement_rule_code:'share_only',channel_fee_mode:'none',tax_mode:'none',
      settlement_amount:144.4,system_settlement_amount:135.85,platform_settlement_amount:144.4,
      settlement_difference:-8.55,validation_status:'fail'}], ...options.record
  }
  const requests=[]; const approvals=[]
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()); const path=url.pathname
    if (!path.startsWith('/api/')) return route.continue()
    const method=route.request().method();requests.push({method,path})
    if(path==='/api/auth/me') return route.fulfill({json:{id:'test-admin',role:'admin',permissions:[]}})
    if(path==='/api/channel-records/UI-REVIEW') {
      expect(method).toBe('GET')
      return route.fulfill({json:record})
    }
    if(path.endsWith('/manual-review-exception')) {
      expect(url.searchParams.get('expected_updated_at')).toBe(record.updated_at)
      return route.fulfill({json:{exception:options.noException?null:{
        code:'4399_july_2026_single_bill_v1',partner_id:'customer-id',partner_name:record.partner_name,
        bill_id:record.id,statement_no:record.statement_no,settlement_month:record.settlement_month,
        review_revision:'a'.repeat(64),updated_at:record.updated_at
      }}})
    }
    if(path==='/api/contract-terms/reconcile-v3') {
      if(options.preflightGate) await options.preflightGate
      return route.fulfill({json:{summary:{fail_count:0},bill_checks:[],lines:[{line_id:'J1',status:'pass',checks:[]}]}})
    }
    if(path.endsWith('/confirm-platform-variance')) {
      const body=route.request().postDataJSON();approvals.push(body)
      if(options.approvalGate) await options.approvalGate
      if(options.stale) return route.fulfill({status:409,json:{detail:{error:'manual_review_revision_changed',message:'账单原始字段或版本已变化，请重新打开并人工核对；本次未确认'}}})
      return route.fulfill({json:{bill_id:record.id,status:'confirmed'}})
    }
    if(path==='/api/contract-terms/reconcile-snapshots') return route.fulfill({json:{id:'mock-snapshot'}})
    if(path.startsWith('/api/bill-attachments/')) return route.fulfill({json:{items:[]}})
    return route.fulfill({status:404,json:{detail:'isolated fixture'}})
  })
  await page.goto('/tests/fixtures/channel-review-page.html')
  await expect(page.locator('#core-channel-bill-form')).toBeVisible()
  return {requests,approvals}
}
async function start(page) {
  await page.locator('.core-bill-footer .confirm-review').click()
  // Existing platform discrepancies enter their evidence panel directly, not
  // the ordinary bill confirmation dialog. Keep the real workflow unchanged.
  await expect(page.locator('#channel-small-variance-approval')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function fillBasis(page) {
  await page.getByLabel('真实人工核对依据（必填，至少12个字）').fill('已逐项核实真实对账来源，本单按授权保留差异并人工确认。')
  await page.getByRole('checkbox',{name:/我已核实上述依据/}).check()
}
const confirmation=page=>page.getByRole('button',{name:'按文字依据确认本单¥144.40（免附件）'})

test('single bill needs written basis and explicit consent; records exact revision without attachment or financial write', async({page})=>{
  const {approvals,requests}=await setup(page)
  await start(page)
  await expect(page.getByRole('region',{name:'单笔免附件人工核对'})).toBeVisible()
  await expect(confirmation(page)).toBeDisabled()
  await page.getByLabel('真实人工核对依据（必填，至少12个字）').fill('已逐项核实真实对账来源，本单按授权保留差异并人工确认。')
  await expect(confirmation(page)).toBeDisabled()
  await page.getByRole('checkbox',{name:/我已核实上述依据/}).check()
  await confirmation(page).click()
  await expect.poll(()=>approvals.length).toBe(1)
  expect(approvals[0]).toMatchObject({manual_review_exception:'4399_july_2026_single_bill_v1',manual_review_revision:'a'.repeat(64),
    manual_review_confirmed:true,expected_partner_id:'customer-id',expected_system_amount:135.85,
    expected_platform_amount:144.4,expected_settlement_amount:144.4,expected_signed_difference_cents:-855,
    evidence_attachment_id:null,evidence_confirmed:false})
  expect(approvals[0].reason).not.toContain('已按所选平台原始结算凭证')
  expect(requests.some(r=>r.path.startsWith('/api/bill-attachments/'))).toBe(false)
  expect(requests.some(r=>r.method==='PUT'||r.method==='DELETE'||r.path.includes('/receipts'))).toBe(false)
})

test('cancel and reopen clears basis and consent rather than reusing an approval',async({page})=>{
  const {approvals}=await setup(page);await start(page);await fillBasis(page)
  await page.getByRole('region',{name:'单笔免附件人工核对'}).getByRole('button',{name:'取消'}).click()
  await start(page)
  await expect(page.getByLabel('真实人工核对依据（必填，至少12个字）')).toHaveValue('')
  await expect(page.getByRole('checkbox',{name:/我已核实上述依据/})).not.toBeChecked()
  await expect(confirmation(page)).toBeDisabled();expect(approvals).toEqual([])
})

test('edited basis requires consent again',async({page})=>{
  await setup(page);await start(page);await fillBasis(page)
  await page.getByLabel('真实人工核对依据（必填，至少12个字）').fill('已经重新核实本单全部来源，按真实平台金额确认并保留差异。')
  await expect(page.getByRole('checkbox',{name:/我已核实上述依据/})).not.toBeChecked()
  await expect(confirmation(page)).toBeDisabled()
})

for(const [label,options] of [
  ['other channel',{record:{channel_name:'其他渠道'}}],
  ['other month',{record:{settlement_month:'2026-08'}}],
  ['other bill',{record:{statement_no:'QD-OTHER'}}],
  ['server refuses exception',{noException:true}]
]) test(`${label} keeps the existing original-attachment requirement`,async({page})=>{
  const {approvals}=await setup(page,options);await start(page)
  await expect(page.getByRole('region',{name:'单笔免附件人工核对'})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'我已核对凭证，按平台¥144.40确认账单'})).toBeDisabled()
  expect(approvals).toEqual([])
})

test('stale full-field revision is not silently retried or reported confirmed',async({page})=>{
  const {approvals}=await setup(page,{stale:true});await start(page);await fillBasis(page);await confirmation(page).click()
  await expect(page.getByRole('alert')).toContainText('账单原始字段或版本已变化')
  await expect(confirmation(page)).toHaveCount(0)
  expect(approvals).toHaveLength(1)
  expect(await page.evaluate(()=>window.reviewTest.navigations)).toEqual([])
})

test('repeated clicks while confirmation is pending submit once',async({page})=>{
  let release; const gate=new Promise(resolve=>{release=resolve})
  const {approvals}=await setup(page,{approvalGate:gate});await start(page);await fillBasis(page)
  await confirmation(page).dblclick()
  await expect.poll(()=>approvals.length).toBe(1)
  release()
  await expect.poll(()=>page.evaluate(()=>window.reviewTest.navigations.length)).toBe(1)
  expect(approvals).toHaveLength(1)
})


test('leaving during confirmed-list refresh does not redirect or announce success in the next page',async({page})=>{
  const {approvals}=await setup(page);await start(page);await fillBasis(page)
  await page.evaluate(()=>{window.reviewTest.refreshGate=new Promise(resolve=>{window.releaseReviewRefresh=resolve})})
  await confirmation(page).click()
  await expect.poll(()=>page.evaluate(()=>window.reviewTest.refreshStarted)).toBe(true)
  await page.evaluate(()=>window.unmountReviewPage())
  await expect(page.getByText('已离开账单')).toBeVisible()
  await page.evaluate(async()=>{window.releaseReviewRefresh();await window.reviewTest.refreshGate})
  expect(approvals).toHaveLength(1)
  expect(await page.evaluate(()=>window.reviewTest.navigations)).toEqual([])
  expect(await page.evaluate(()=>window.reviewTest.toasts.filter(item=>item.tone==='success'))).toEqual([])
})
