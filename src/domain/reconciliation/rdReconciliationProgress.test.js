import { describe, expect, it } from 'vitest'
import { summarizeRdReconciliationProgress } from './rdReconciliationProgress.js'

describe('rd reconciliation progress', () => {
  it('calculates reconciliation amount and row progress independently', () => {
    const summary = summarizeRdReconciliationProgress([
      {
        id: '1',
        settlementNumber: 'JS-001',
        settlementMonth: '2026-06',
        partnerShortName: '客户甲',
        game: '游戏A',
        gameFlow: 9000,
        settlementAmount: 900,
        paidAmount: 900,
        paymentStatus: '已付款',
        status: 'settled'
      },
      {
        id: '2',
        settlementNumber: 'JS-002',
        settlementMonth: '2026-06',
        partnerShortName: '客户乙',
        game: '游戏B',
        gameFlow: 1000,
        settlementAmount: 100,
        paidAmount: 0,
        status: 'pending'
      }
    ])

    expect(summary.totals.rows).toBe(2)
    expect(summary.totals.flowAmount).toBe(10000)
    expect(summary.totals.reconciledRows).toBe(1)
    expect(summary.totals.reconciliationAmountPercent).toBe(90)
    expect(summary.totals.reconciliationRowPercent).toBe(50)
    expect(summary.totals.paymentAmountPercent).toBe(90)
    expect(summary.totals.unresolvedRows).toBe(1)
    expect(summary.unresolved[0].billNumber).toBe('JS-002')
  })

  it('excludes cancelled records and reports missing source data', () => {
    const summary = summarizeRdReconciliationProgress([
      {
        id: '1',
        settlementAmount: 200,
        status: 'cancelled'
      },
      {
        id: '2',
        settlementNumber: 'JS-002',
        settlementAmount: 300,
        status: 'confirmed'
      }
    ])

    expect(summary.totals.rows).toBe(1)
    expect(summary.totals.cancelledRows).toBe(1)
    expect(summary.totals.reconciledRows).toBe(1)
    expect(summary.totals.unresolvedRows).toBe(1)
    expect(summary.unresolved[0].reason).toContain('缺少流水')
    expect(summary.unresolved[0].reason).toContain('未关联客户')
  })
})
