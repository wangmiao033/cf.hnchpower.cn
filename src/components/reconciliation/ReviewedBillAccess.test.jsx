import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '@/app/AppStateContext.jsx'
import {
  canRequestReviewedBillAmendment,
  isValidReviewedBillAmendmentNote
} from '@/domain/reconciliation/billLifecycle.js'
import LockedBillEditNotice from './LockedBillEditNotice.jsx'
import RdBillReadonlyView from './RdBillReadonlyView.jsx'

function renderBill(state) {
  return renderToStaticMarkup(
    <AppStateProvider value={{ recon: {}, showToast() {} }}>
      <LockedBillEditNotice
        billType="rd"
        record={{ id: 'RD-1', status: state }}
        onOpen360={() => {}}
        onBack={() => {}}
      >
        <span>已保存的原始账单明细</span>
      </LockedBillEditNotice>
    </AppStateProvider>
  )
}

describe('reviewed bill access with mandatory edit note', () => {
  it('shows reviewed bill details directly instead of the blocking lock page', () => {
    const html = renderBill('confirmed')
    expect(html).toContain('账单详情 · 已核对')
    expect(html).toContain('已保存的原始账单明细')
    expect(html).toContain('修改账单（填写备注）')
    expect(html).toContain('查看核对结果')
    expect(html).not.toContain('账单已核对并锁定')
    expect(html).not.toContain('退回修改')
  })

  it('permits view-only access to canceled bill without enabling editing', () => {
    const html = renderBill('cancelled')
    expect(html).toContain('已保存的原始账单明细')
    expect(html).not.toContain('修改账单（填写备注）')
  })

  it('does not allow modifying a reviewed bill without a meaningful note', () => {
    expect(canRequestReviewedBillAmendment('confirmed')).toBe(true)
    expect(canRequestReviewedBillAmendment('reconciled')).toBe(true)
    expect(canRequestReviewedBillAmendment('cancelled')).toBe(false)
    expect(canRequestReviewedBillAmendment('pending')).toBe(false)
    expect(isValidReviewedBillAmendmentNote('  ')).toBe(false)
    expect(isValidReviewedBillAmendmentNote('改')).toBe(false)
    expect(isValidReviewedBillAmendmentNote('按结算函修改分成')).toBe(true)
  })

  it('renders the full original RD settlement fields, payments and per-game rows', () => {
    const html = renderToStaticMarkup(
      <RdBillReadonlyView record={{
        id: 'RD-1',
        settlementNumber: 'JS-202608-001',
        settlementPeriodLabel: '2026年7月—2026年8月',
        partner: '研发合作公司',
        status: 'confirmed',
        settlementAmount: '1839.23',
        actualPayable: '1539.23',
        paidAmount: '1000',
        unpaidAmount: '539.23',
        prepaymentDeduction: '300',
        memo: '历史账单核对备注',
        items: [{
          id: 'line-1',
          settlementCycle: '2026年8月',
          gameName: '云上征途',
          revenue: '5000',
          discountRate: '1',
          netRevenue: 5000,
          couponAmount: '20',
          testFee: '10',
          extraFee: '0',
          shareRatio: '28',
          taxRate: '5',
          shareAmount: 1400,
          settlementAmount: 1330
        }]
      }} />
    )
    expect(html).toContain('JS-202608-001')
    expect(html).toContain('研发合作公司')
    expect(html).toContain('2026年7月—2026年8月')
    expect(html).toContain('¥1,839.23')
    expect(html).toContain('¥1,000.00')
    expect(html).toContain('¥539.23')
    expect(html).toContain('逐游戏结算明细')
    expect(html).toContain('云上征途')
    expect(html).toContain('28%')
    expect(html).toContain('历史账单核对备注')
    expect(html).toContain('账单附件')
    expect(html).not.toContain('保存修改')
  })
})
