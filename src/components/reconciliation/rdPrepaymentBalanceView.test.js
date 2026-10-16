import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ReconciliationLineItemsForm from './ReconciliationLineItemsForm.jsx'

describe('研发账单预付款余额', () => {
  it('shows the statement prepayment balance and the payable after deduction', () => {
    const html = renderToStaticMarkup(React.createElement(ReconciliationLineItemsForm, {
      layout: 'createPage',
      mode: 'edit',
      editRecord: {
        partnerId: 'partner-1',
        partner: '广东趣玩网络科技有限公司',
        channelFeeRate: '0',
        statementPrepaymentTouched: true,
        statementPrepaymentDeduction: 436.07,
        items: [
          { gameName: '龙吟大陆', settlementCycle: '2026年1月', revenue: 26840, discountRate: 1, shareRatio: 15, couponAmount: 0, testFee: 0, extraFee: 0, taxRate: 0 },
          { gameName: '龙吟大陆专服2', settlementCycle: '2026年1月', revenue: 961, discountRate: 1, shareRatio: 15, couponAmount: 0, testFee: 0, extraFee: 0, taxRate: 0 },
          { gameName: '龙吟大陆专服爱趣', settlementCycle: '2026年1月', revenue: 983, discountRate: 1, shareRatio: 15, couponAmount: 0, testFee: 0, extraFee: 0, taxRate: 0 }
        ]
      }
    }))
    expect(html).toContain('预付款余额')
    expect(html).toContain('aria-label="预付款余额"')
    expect(html).toContain('value="436.07"')
    expect(html).toContain('实际应付')
    expect(html).toContain('¥3881.53')
    expect(html).toContain('¥4317.60')
    expect(html).toContain('已按对账单预付款余额抵扣')
  })
})
