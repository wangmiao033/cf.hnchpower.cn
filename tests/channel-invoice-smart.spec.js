import { test, expect } from '@playwright/test'

const partner = '湖南天宇互动网络科技有限公司'
const summary = (id, amount) => ({
  bill_type:'channel',bill_id:id,bill_amount:amount,allocated_amount:0,
  remaining_amount:amount,coverage_percent:0,coverage_status:'none',
  allocations:[],candidates:[]
})
const invoice = {
  invoice_direction:'output',invoice_type:'电子发票（增值税普通发票）',
  digital_invoice_no:'26442000002619268196',invoice_code:null,invoice_no:null,
  buyer_name:partner,buyer_tax_no:'914300000000000001',
  seller_name:'广州熊动科技有限公司',seller_tax_no:'91440104MABURP0XXA',
  invoice_date:'2026-03-11',
  invoice_amount:63.02,tax_amount:3.78,amount_with_tax:66.80,
  source_file_name:'天宇-熊动12-2月账单发票.pdf',
  source_file_url:'https://private.example.com/invoice-files/2026/03/source.pdf',
  source_file_type:'application/pdf',source_file_size:103573
}

test('upload issued electronic PDF → recommend December/January with February → confirm one official link', async ({page}) => {
  let posted = null
  page.on('dialog', dialog => void dialog.accept())
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/bill-invoice-allocations/bill/channel/feb')
      return route.fulfill({json:summary('feb',36.46)})
    if (path === '/api/reconciliation/bill-invoice-overviews')
      return route.fulfill({json:{items:[
        {key:'channel:dec',...summary('dec',10.12)},
        {key:'channel:jan',...summary('jan',20.22)},
        {key:'channel:feb',...summary('feb',36.46)}
      ]}})
    if (path.startsWith('/api/bill-invoice-allocations/bill/channel/')) {
      const id = path.split('/').pop()
      return route.fulfill({json:summary(id,id==='dec'?10.12:id==='jan'?20.22:36.46)})
    }
    if (path === '/api/electronic-invoices/parse') {
      return route.fulfill({json:{
        parser:'pdf_text',confidence:1,warnings:[],source_file_proof:'signed-by-parser',
        existing_invoice_id:null,invoice
      }})
    }
    if (path === '/api/channel-records') {
      const records = [
        {id:'feb',partner_name:partner,channel_name:'天宇游戏',settlement_month:'2026-02',status:'confirmed',settlement_amount:36.46},
        {id:'jan',partner_name:partner,channel_name:'天宇游戏',settlement_month:'2026-01',status:'confirmed',settlement_amount:20.22},
        {id:'dec',partner_name:partner,channel_name:'天宇游戏',settlement_month:'2025-12',status:'confirmed',settlement_amount:10.12},
        {id:'other',partner_name:'另一家有限公司',channel_name:'天宇游戏',settlement_month:'2026-01',status:'confirmed',settlement_amount:99}
      ]
      return route.fulfill({json:{items:records,total:records.length}})
    }
    if (path === '/api/channel-invoice-merge/issue') {
      posted = route.request().postDataJSON()
      return route.fulfill({json:{
        invoice_id:'new-invoice',invoice_number:invoice.digital_invoice_no,
        allocated_bills:3,allocated_amount:66.80,bill_ids:['feb','jan','dec'],
        linked_existing:false
      }})
    }
    return route.abort()
  })

  await page.goto('/tests/fixtures/channel-invoice-smart.html')
  await expect(page.getByText('智能发票关联')).toBeVisible()
  await page.getByLabel('选择电子发票文件').setInputFiles({
    name:'天宇-熊动12-2月账单发票.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF mocked fixture')
  })
  await expect(page.getByText('26442000002619268196')).toBeVisible()
  await expect(page.getByText('发票金额高于当前账单')).toBeVisible()
  await expect(page.getByRole('button',{name:/加入 2 张相关月份账单/})).toBeVisible()
  await page.getByRole('button',{name:/加入 2 张相关月份账单/}).click()
  await expect(page.getByText('✓ 金额完全匹配，可以在核对票号与主体后关联。')).toBeVisible()
  await expect(page.locator('.channel-invoice-merge-table tbody tr')).toHaveCount(3)
  await expect(page.getByRole('button',{name:'核对无误 · 关联 ¥66.80'})).toBeEnabled()
  await page.getByRole('button',{name:'核对无误 · 关联 ¥66.80'}).click()
  await expect.poll(() => posted).not.toBeNull()
  expect(posted).toMatchObject({
    bill_ids:['feb','jan','dec'],
    amount_with_tax:66.8,
    tax_amount:3.78,
    source_file_proof:'signed-by-parser',
    existing_invoice_id:null,
    buyer_name:partner
  })
  await expect.poll(() => page.evaluate(() => document.body.dataset.completed)).toBe('new-invoice')
  expect(errors).toEqual([])
})
