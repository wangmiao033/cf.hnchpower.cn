import { describe, expect, it } from 'vitest'
import {
  buildRdMonthlyProgressRecords,
  buildRdSettlementPeriodOptions,
  formatRdSettlementPeriodLabel,
  getRdRecordSettlementPeriods,
  rdCompatibilitySettlementMonth,
  rdRecordMatchesSettlementPeriod,
  rdRecordSettlementPeriodLabel,
  sliceRdRecordForSettlementPeriod
} from './rdSettlementPeriods.js'

const MULTI_PERIOD_BILL = {
  id: 'bill-1',
  settlementNumber: 'JS-20260806-001',
  settlementMonth: '2026年5月',
  partner: '海南奇趣网络科技有限公司',
  channelFeeRate: 0,
  paidAmount: 0,
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
  gameFlow: 450,
  settlementAmount: 450
}

describe('research bill settlement periods', () => {
  it('formats single, continuous and non-continuous periods', () => {
    expect(formatRdSettlementPeriodLabel(['2026-05'])).toBe('2026年5月')
    expect(formatRdSettlementPeriodLabel(['2026年6月', '2026年5月'])).toBe(
      '2026年5月—2026年6月'
    )
    expect(formatRdSettlementPeriodLabel(['2026年7月', '2026年5月'])).toBe(
      '2026年5月、2026年7月'
    )
  })

  it('keeps all line periods on one bill and uses the first period only as compatibility data', () => {
    expect(getRdRecordSettlementPeriods(MULTI_PERIOD_BILL)).toEqual([
      '2026年5月',
      '2026年6月'
    ])
    expect(rdRecordSettlementPeriodLabel(MULTI_PERIOD_BILL)).toBe(
      '2026年5月—2026年6月'
    )
    expect(rdCompatibilitySettlementMonth(MULTI_PERIOD_BILL.items)).toBe('2026年5月')
  })

  it('shows one master row in either monthly filter', () => {
    const records = [MULTI_PERIOD_BILL]
    const mayRows = records.filter((record) => rdRecordMatchesSettlementPeriod(record, '2026-05'))
    const juneRows = records.filter((record) => rdRecordMatchesSettlementPeriod(record, '2026-06'))
    const julyRows = records.filter((record) => rdRecordMatchesSettlementPeriod(record, '2026-07'))

    expect(mayRows).toHaveLength(1)
    expect(juneRows).toHaveLength(1)
    expect(julyRows).toHaveLength(0)
    expect(mayRows[0].settlementNumber).toBe('JS-20260806-001')
    expect(juneRows[0].settlementNumber).toBe('JS-20260806-001')
    expect(buildRdSettlementPeriodOptions(records)).toEqual(['2026-06', '2026-05'])
  })

  it('splits monthly statistics by line period, not by bill total', () => {
    const may = sliceRdRecordForSettlementPeriod(MULTI_PERIOD_BILL, '2026-05')
    const june = sliceRdRecordForSettlementPeriod(MULTI_PERIOD_BILL, '2026-06')

    expect(may.items).toHaveLength(1)
    expect(may.gameFlow).toBe(280)
    expect(may.settlementAmount).toBe(280)
    expect(may.items[0].settlementCycle).toBe('2026年5月')

    expect(june.items).toHaveLength(1)
    expect(june.gameFlow).toBe(170)
    expect(june.settlementAmount).toBe(170)
    expect(june.items[0].settlementCycle).toBe('2026年6月')

    expect(may.id).toBe('bill-1')
    expect(june.id).toBe('bill-1')
    expect(new Set([may.id, june.id])).toEqual(new Set(['bill-1']))
    expect(buildRdMonthlyProgressRecords([MULTI_PERIOD_BILL], '2026-05')).toHaveLength(1)
    expect(buildRdMonthlyProgressRecords([MULTI_PERIOD_BILL], '2026-06')).toHaveLength(1)
  })

  it('keeps legacy single-period bills working', () => {
    const legacy = {
      ...MULTI_PERIOD_BILL,
      id: 'legacy',
      settlementMonth: '2026年5月',
      settlementAmount: 280,
      items: [MULTI_PERIOD_BILL.items[0]]
    }
    expect(rdRecordSettlementPeriodLabel(legacy)).toBe('2026年5月')
    expect(sliceRdRecordForSettlementPeriod(legacy, '2026-05').settlementAmount).toBe(280)
  })
})
