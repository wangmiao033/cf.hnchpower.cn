import { describe, expect, it } from 'vitest'
import {
  buildSettlementSheetAoa,
  buildSettlementWorkbookFromSelected,
  expandRdRecordsForSettlementExport
} from './settlementConfirmationExport.js'

const bill = {
  id: 'bill-1',
  settlementNumber: 'JS-20260806-001',
  settlementMonth: '2026年5月',
  partner: '海南奇趣网络科技有限公司',
  partnerShortName: '奇趣',
  channelFeeRate: 0,
  items: [
    {
      id: 'line-1',
      settlementCycle: '2026年5月',
      gameName: '魔法启示录',
      revenue: 280,
      discountRate: 1,
      couponAmount: 0,
      testFee: 0,
      extraFee: 0,
      shareRatio: 100,
      taxRate: 0,
      settlementAmount: 280
    },
    {
      id: 'line-2',
      settlementCycle: '2026年6月',
      gameName: '魔法启示录',
      revenue: 170,
      discountRate: 1,
      couponAmount: 0,
      testFee: 0,
      extraFee: 0,
      shareRatio: 100,
      taxRate: 0,
      settlementAmount: 170
    }
  ],
  settlementAmount: 450
}

describe('multi-period research bill export', () => {
  it('exports one bill as two detail lines with independent periods and a 450 total', () => {
    const lines = expandRdRecordsForSettlementExport([bill])

    expect(lines).toHaveLength(2)
    expect(lines.map((line) => line.settlementMonth)).toEqual([
      '2026年5月',
      '2026年6月'
    ])
    expect(lines.map((line) => line.settlementAmount)).toEqual([280, 170])
    expect(lines.reduce((sum, line) => sum + Number(line.settlementAmount || 0), 0)).toBe(450)

    const aoa = buildSettlementSheetAoa([bill])
    const flattened = aoa.flat().map((value) => String(value ?? ''))
    expect(flattened.some((value) => value.includes('5月'))).toBe(true)
    expect(flattened.some((value) => value.includes('6月'))).toBe(true)
    expect(flattened).toContain('450')
  })

  it('creates one formal worksheet named by the single master bill number', () => {
    const { wb } = buildSettlementWorkbookFromSelected([bill])
    expect(wb.SheetNames).toEqual(['JS-20260806-001'])
  })
})
