import { describe, expect, it, vi } from 'vitest'
import {
  buildSettlementSheetAoa,
  buildSettlementWorkbookFromSelected,
  expandRdRecordsForSettlementExport,
  resolveRdRecordsForSettlementExport,
  toChineseUppercase
} from './settlementConfirmationExport.js'

const record = {
  id: '5',
  settlementNumber: 'JS-20260723-005',
  settlementMonth: '2026年6月',
  createdAt: '2026-07-27T03:00:00.000Z',
  partnerId: 'partner-1',
  partner: '广州明朝互动科技股份有限公司',
  channelFeeRate: '0',
  items: [
    {
      settlementCycle: '2026年6月',
      gameName: '六界飞仙0.1折',
      revenue: '291480',
      discountRate: '0.01',
      couponAmount: '0',
      testFee: '77.28',
      extraFee: '0',
      shareRatio: '20',
      taxRate: '0'
    },
    {
      settlementCycle: '2026年6月',
      gameName: '云上征途0.05折',
      revenue: '304874',
      discountRate: '0.005',
      couponAmount: '172.18',
      testFee: '0',
      extraFee: '0',
      shareRatio: '20',
      taxRate: '0'
    }
  ]
}

describe('formal R&D settlement export', () => {
  it('keeps the existing settlement calculations in the formal detail rows', () => {
    const rows = expandRdRecordsForSettlementExport([record])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      revenue: 291480,
      discountedFlow: 2914.8,
      testingFee: 77.28,
      shareAmount: 2837.52,
      settlementAmount: 567.5
    })
    expect(rows[1]).toMatchObject({
      revenue: 304874,
      discountedFlow: 1524.37,
      voucher: 172.18,
      shareAmount: 1352.19,
      settlementAmount: 270.44
    })
  })

  it('replaces a list summary with the full multi-game detail before export', async () => {
    const summary = {
      ...record,
      game: '六界飞仙、云上征途',
      gameFlow: '596354',
      items: [
        {
          gameName: '六界飞仙、云上征途',
          revenue: '596354',
          discountRate: '0.01',
          shareRatio: '20'
        }
      ]
    }
    const loadRecord = vi.fn().mockResolvedValue(record)

    const resolved = await resolveRdRecordsForSettlementExport([summary], loadRecord)
    const rows = expandRdRecordsForSettlementExport(resolved)

    expect(loadRecord).toHaveBeenCalledWith('5', summary)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.game)).toEqual(['六界飞仙0.1折', '云上征途0.05折'])
  })

  it('builds the requested statement sections and customer-bank data', () => {
    const data = buildSettlementSheetAoa([record], {
      partners: [
        {
          id: 'partner-1',
          name: '广州明朝互动科技股份有限公司',
          bankName: '招商银行广州科技园支行',
          bankAccount: '120907560010604'
        }
      ]
    })
    expect(data[1][1]).toBe('《六界飞仙0.1折》、《云上征途0.05折》 6月对账单')
    expect(data[3][1]).toBe('2026-06-01 ~ 2026-06-30')
    expect(data[6]).toContain('参与分成金额')
    expect(data.flat()).toContain('涉及未成年退款渠道')
    expect(data.flat()).toContain('重要说明')
    expect(data.flat().some((value) => String(value).includes('120907560010604'))).toBe(true)
  })

  it('creates a styled workbook with a customer-facing filename', () => {
    const { wb, fileName } = buildSettlementWorkbookFromSelected([record])
    const sheet = wb.Sheets[wb.SheetNames[0]]
    expect(fileName).toBe('《六界飞仙0.1折、云上征途0.05折》6月对账单.xlsx')
    expect(sheet['!merges'].length).toBeGreaterThan(8)
    expect(sheet.A7.s.fill.fgColor.rgb).toBe('9DC3E6')
    expect(sheet.B8.z).toBe('#,##0.00')
    expect(sheet.I8.z).toBe('0%')
    expect(sheet['!pageSetup']).toMatchObject({ orientation: 'landscape', fitToWidth: 1 })
  })

  it('formats Chinese uppercase money', () => {
    expect(toChineseUppercase(837.94)).toBe('捌佰叁拾柒元玖角肆分')
    expect(toChineseUppercase(0)).toBe('零元整')
  })
})
