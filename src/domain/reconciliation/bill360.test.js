import { describe, expect, it } from 'vitest'
import {
  bill360Lines,
  bill360QuickSdkKeys,
  filterBill360Contracts,
  summarizeBill360
} from './bill360.js'

describe('bill360 helpers', () => {
  it('summarizes multi-period RD bill and database flow difference', () => {
    const record = {
      settlementAmount: '450.00',
      paidAmount: '300.00',
      items: [
        { id: '1', settlementCycle: '2026-05', gameName: 'A', revenue: '1000', settlementAmount: 200 },
        { id: '2', settlementCycle: '2026年6月', gameName: 'A', revenue: '1200', settlementAmount: 250 }
      ]
    }
    expect(bill360QuickSdkKeys('rd', record)).toEqual([
      { key: '2026-05::A', month: '2026-05', game: 'A' },
      { key: '2026-06::A', month: '2026-06', game: 'A' }
    ])
    expect(summarizeBill360({
      billType: 'rd',
      record,
      invoiceSummary: { allocated_amount: 400, remaining_amount: 50 },
      quickSdkRows: [{ total_flow: 1000 }, { total_flow: 1250 }]
    })).toMatchObject({
      settlementAmount: 450,
      settlementMagnitude: 450,
      settlementKind: 'normal',
      cashDirection: 'payable',
      cashLabel: '应付',
      paidLabel: '已付款',
      paidAmount: 300,
      unpaidAmount: 150,
      invoiceAllocated: 400,
      invoiceRemaining: 50,
      billFlow: 2200,
      databaseFlow: 2250,
      flowDifference: 50,
      flowMatched: false
    })
  })

  it('normalizes channel line items without QuickSDK requests', () => {
    const record = {
      settlementMonth: '2026-07',
      items: [{ gameName: 'B', flow: 500, shareRate: 30, settlementAmount: 100 }]
    }
    expect(bill360Lines('channel', record)[0]).toMatchObject({ month: '2026-07', game: 'B', flow: 500 })
    expect(bill360QuickSdkKeys('channel', record)).toEqual([])
  })

  it('uses channel game lines as the receivable source even when the legacy header is stale', () => {
    const record = {
      settlementMonth: '2026-06',
      settlementAmount: 0,
      receivedAmount: 50,
      items: [
        { id: 'g1', gameName: '游戏A', flow: 1000, discountFactor: 0.5, settlementAmount: 100 },
        { id: 'g2', gameName: '游戏B', flow: 2000, discountFactor: 1, settlementAmount: 200 }
      ]
    }
    const summary = summarizeBill360({ billType: 'channel', record, invoiceSummary: null })
    expect(summary).toMatchObject({
      settlementAmount: 300,
      settlementMagnitude: 300,
      settlementKind: 'normal',
      cashDirection: 'receivable',
      cashLabel: '应收',
      paidLabel: '已收款',
      paidAmount: 50,
      unpaidAmount: 250,
      billFlow: 2500
    })
    expect(summary.paymentPercent).toBeCloseTo(50 / 3, 10)
  })

  it('treats zero settlement as completed without requiring cash or invoice actions', () => {
    const record = {
      settlementMonth: '2026-06',
      receivedAmount: 0,
      items: [
        { id: 'g1', gameName: '游戏A', flow: 100, settlementAmount: 0 },
        { id: 'g2', gameName: '游戏B', flow: 200, settlementAmount: 0 }
      ]
    }
    expect(summarizeBill360({ billType: 'channel', record, invoiceSummary: null })).toMatchObject({
      settlementAmount: 0,
      settlementMagnitude: 0,
      settlementKind: 'zero',
      cashDirection: 'none',
      cashLabel: '无需收付款',
      paidLabel: '无需资金动作',
      unpaidAmount: 0,
      paymentPercent: 100,
      invoiceRemaining: 0,
      invoicePercent: 100,
      invoiceRequired: false
    })
  })

  it('preserves negative channel settlement as reverse payable instead of taking absolute value', () => {
    const record = {
      settlementMonth: '2026-06',
      receivedAmount: 0,
      items: [
        { id: 'g1', gameName: '游戏A', flow: 1000, settlementAmount: -500 }
      ]
    }
    expect(summarizeBill360({ billType: 'channel', record, invoiceSummary: null })).toMatchObject({
      settlementAmount: -500,
      settlementMagnitude: 500,
      settlementKind: 'reverse',
      cashDirection: 'payable',
      cashLabel: '反向应付',
      paidLabel: '已付款',
      unpaidAmount: 500
    })
  })

  it('preserves negative RD settlement as reverse receivable', () => {
    const record = { settlementAmount: -200, paidAmount: 0, items: [] }
    expect(summarizeBill360({ billType: 'rd', record, invoiceSummary: null })).toMatchObject({
      settlementAmount: -200,
      settlementMagnitude: 200,
      settlementKind: 'reverse',
      cashDirection: 'receivable',
      cashLabel: '反向应收',
      paidLabel: '已收款',
      unpaidAmount: 200
    })
  })

  it('matches contracts by partner id or normalized company name', () => {
    const contracts = [
      { id: 'c1', partner_id: 'p1', partner_name: '甲公司有限公司' },
      { id: 'c2', partner_id: 'p2', counterparty: '乙 科技有限公司' }
    ]
    expect(filterBill360Contracts(contracts, '无关', 'p1').map((item) => item.id)).toEqual(['c1'])
    expect(filterBill360Contracts(contracts, '乙科技有限公司').map((item) => item.id)).toEqual(['c2'])
  })
})
