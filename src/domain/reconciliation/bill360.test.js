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

  it('matches contracts by partner id or normalized company name', () => {
    const contracts = [
      { id: 'c1', partner_id: 'p1', partner_name: '甲公司有限公司' },
      { id: 'c2', partner_id: 'p2', counterparty: '乙 科技有限公司' }
    ]
    expect(filterBill360Contracts(contracts, '无关', 'p1').map((item) => item.id)).toEqual(['c1'])
    expect(filterBill360Contracts(contracts, '乙科技有限公司').map((item) => item.id)).toEqual(['c2'])
  })
})
