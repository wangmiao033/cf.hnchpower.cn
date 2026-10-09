import { describe, expect, it } from 'vitest'
import { parseJdBillWithDetails, parseJdExpenseHash, jdBillToExpenseForm } from './jdLogisticsBill.js'

const summaryRows = [
  [], [null, null, '京 东 物 流 账 单 明 细'],
  [], [], [], [], [],
  [null, '客  户  名  称', '广州熊动科技有限公司-020K7883722'],
  [null, '结  算  日  期', '2026-09-01 - 2026-09-30'],
  [null, '结  算  单  号', 'BR2105791606329257984'],
  [null, '费  用  科  目', '收派服务费'],
  [null, '单            量', 15],
  [null, '应  付  合  计', 171],
  [], [], [], [null, '商家编号', '费用类型', '方向', '原始金额', '折扣金额', '调账金额', '结算金额'],
  [null, '020K7883722', '快递运费', '商家应付', 228, 57, 0, 171],
  [], [], [], [], [], [], [], [], [], [], [], [],
  [null, '涉及主体如下', '广东京邦达供应链科技有限公司']
]

const details = [
  ['商家编号','业务单号','运单号','退回件关联运单号','下单时间','始发省','始发市','目的省','目的市','寄件人','收件人','计费重量','实际重量(kg)','实际体积(cm3)','包裹/耗材数量','托寄物内容','产品类型','费用类型','原始金额','折扣/促销金额','调账金额','结算金额','计费id'],
  ...Array.from({ length: 15 }, (_, idx) => [null, null, `JDVC${idx}`, ...Array(14).fill(null), '快递运费', 12, 3, 0, idx === 0 ? 3 : 12])
]

describe('JD Logistics expense quick import', () => {
  it('parses the official monthly statement into a single unpaid accounting entry', () => {
    const bill = parseJdBillWithDetails(summaryRows)
    expect(bill).toMatchObject({ expenseMonth: '2026-09', amount:171, original:228, discount:57, count:15, billNo:'BR2105791606329257984' })
    const form = jdBillToExpenseForm(bill, { invoiceNumber:'' })
    expect(form).toMatchObject({ paymentStatus:'unpaid', invoiceStatus:'pending', expenseSubcategory:'courier_logistics', amount:'171.00', vendorName:'京东物流' })
    expect(form.voucherNote).toContain('BR2105791606329257984')
  })
  it('recognizes a private URL-fragment draft link without posting automatically', () => {
    const bill = parseJdExpenseHash('#jd-expense?month=2026-09&billNo=BR2105791606329257984&amount=171&count=15&original=228&discount=57')
    expect(bill.amount).toBe(171)
    expect(bill.periodEnd).toBe('2026-09-30')
    expect(parseJdExpenseHash('#unrelated')).toBeNull()
  })
  it('rejects inflated payable totals and invalid statements', () => {
    expect(() => parseJdBillWithDetails(summaryRows.map((r,i)=>i===12?[null,'应  付  合  计',2820]:r))).toThrow()
    expect(() => parseJdExpenseHash('#jd-expense?month=2026-09&billNo=BR2105791606329257984&amount=2820&count=15&original=228&discount=57')).toThrow()
    expect(() => parseJdBillWithDetails([[null,null,'Not a JD Logistics bill']])).toThrow()
  })
})
