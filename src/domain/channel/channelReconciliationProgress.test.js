import { describe, expect, it } from 'vitest'
import {
  extractChannelProgressMonth,
  summarizeChannelProgressMatrix
} from './channelReconciliationProgress.js'

describe('channel reconciliation progress', () => {
  it('calculates amount and row progress independently', () => {
    const matrix = [
      [
        '产品',
        '渠道',
        '流水',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '后台账单',
        '核对',
        '',
        '对账进度',
        '登应收出账单'
      ],
      ['游戏A', '渠道A', 900, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 900, 0, '', '已完成', '已完成'],
      ['游戏B', '渠道B', 100, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 0, -100, '', '', '']
    ]

    const summary = summarizeChannelProgressMatrix(matrix, {
      fileName: '【财务-渠道对账】2026年6.xlsx',
      sheetName: '2606',
      importedAt: '2026-07-27T00:00:00.000Z'
    })

    expect(summary.month).toBe('2026-06')
    expect(summary.totals.rows).toBe(2)
    expect(summary.totals.sourceFlow).toBe(1000)
    expect(summary.totals.reconciledRows).toBe(1)
    expect(summary.totals.reconciliationAmountPercent).toBe(90)
    expect(summary.totals.reconciliationRowPercent).toBe(50)
    expect(summary.totals.unresolvedFlow).toBe(100)
    expect(summary.unresolved[0].product).toBe('游戏B')
    expect(summary.unresolved[0].matchedBill).toBe(0)
    expect(summary.unresolved[0].unmatchedAmount).toBe(100)
  })

  it('shows the remaining unmatched amount instead of the spreadsheet variance', () => {
    const matrix = [
      ['产品', '渠道', '流水', '后台账单', '核对', '对账进度', '登应收出账单'],
      ['游戏A', '渠道A', 100, 35, -7.5, '', '']
    ]

    const summary = summarizeChannelProgressMatrix(matrix)

    expect(summary.unresolved[0].matchedBill).toBe(35)
    expect(summary.unresolved[0].unmatchedAmount).toBe(65)
    expect(summary.unresolved[0].variance).toBe(-7.5)
  })

  it('extracts month from the source filename', () => {
    expect(extractChannelProgressMonth('【财务-渠道对账】2026年6 (1).xlsx')).toBe('2026-06')
  })
})
