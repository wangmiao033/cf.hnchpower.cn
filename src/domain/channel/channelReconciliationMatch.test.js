import { describe, expect, it } from 'vitest'
import { applyChannelProgressMatch } from './channelReconciliationProgress.js'

describe('channel reconciliation matching', () => {
  it('completes a source row when the selected bill amount matches', () => {
    const snapshot = {
      totals: {
        rows: 2,
        sourceFlow: 1000,
        reconciledRows: 1,
        reconciledFlow: 900,
        reconciliationAmountPercent: 90,
        reconciliationRowPercent: 50,
        unresolvedRows: 1,
        unresolvedFlow: 100
      },
      unresolved: [{ id: 'source-1', sourceFlow: 100, unmatchedAmount: 100 }]
    }

    const result = applyChannelProgressMatch(snapshot, 'source-1', {
      recordId: 'bill-1',
      billNumber: 'QD-001',
      amount: 100,
      matchedAt: '2026-07-28T00:00:00.000Z'
    })

    expect(result.unresolved).toHaveLength(0)
    expect(result.totals.reconciledRows).toBe(2)
    expect(result.totals.reconciledFlow).toBe(1000)
    expect(result.totals.reconciliationAmountPercent).toBe(100)
    expect(result.totals.unresolvedFlow).toBe(0)
  })

  it('keeps a row pending and records the remaining difference', () => {
    const snapshot = {
      totals: {
        rows: 1,
        sourceFlow: 100,
        reconciledRows: 0,
        reconciledFlow: 0,
        unresolvedRows: 1,
        unresolvedFlow: 100
      },
      unresolved: [{ id: 'source-1', sourceFlow: 100, unmatchedAmount: 100 }]
    }

    const result = applyChannelProgressMatch(snapshot, 'source-1', {
      recordId: 'bill-1',
      billNumber: 'QD-001',
      amount: 75
    })

    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0].matchedBill).toBe(75)
    expect(result.unresolved[0].unmatchedAmount).toBe(25)
    expect(result.unresolved[0].matchStatus).toBe('difference')
    expect(result.totals.reconciledRows).toBe(0)
    expect(result.totals.unresolvedFlow).toBe(25)
  })
})
