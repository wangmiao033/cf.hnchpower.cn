import { describe, expect, it } from 'vitest'
import { channelPartnerNames, summarizeChannelUnpaid, cumulativeRowCondition } from './channelCumulativeLedgerSummary.js'

function bill(month, amount, received = 0, status = 'confirmed', channel = '百分', partner = '四川百分网信息科技有限公司') {
  return {
    id: month,
    channelName: channel,
    partnerName: partner,
    status,
    settlementMonth: month,
    settlementAmount: amount,
    receivedAmount: received,
    items: [{ settlementCycle: month, gameName: '一起来修仙' }]
  }
}

describe('channel cumulative ledger read-only summary', () => {
  const rows = [
    bill('2026-01', 30.70, 30.70, 'completed'),
    bill('2026-02', 68.31, 68.31, 'completed'),
    bill('2026-03', 652.67, 652.67, 'completed'),
    bill('2026-04', 887.42, 887.42, 'completed'),
    bill('2026-05', 3.88),
    bill('2026-06', 5.91),
    bill('2026-07', 11.91),
    bill('2026-08', 12.92),
    bill('2026-09', 7.08)
  ]
  it('keeps Jan-Apr paid bills out of the proposed May-Sep pool', () => {
    const result = summarizeChannelUnpaid(rows)
    expect(result.unpaid).toBe(41.7)
    expect(result.unpaidCount).toBe(5)
    expect(result.received).toBe(1639.1)
    expect(result.firstUnpaidMonth).toBe('2026-05')
    expect(result.lastUnpaidMonth).toBe('2026-09')
    expect(result.confirmedUnpaid).toBe(41.7)
    expect(result.unpaidIds).toEqual(['2026-05','2026-06','2026-07','2026-08','2026-09'])
  })
  it('does not claim unconfirmed or partially paid bills are ready for the authoritative pool', () => {
    const result = summarizeChannelUnpaid([
      bill('2026-05', 3.88, 0, 'pending'),
      bill('2026-06', 5.91, 2, 'confirmed'),
      bill('2026-07', 11.91, 0, 'confirmed'),
      bill('2026-08', 12.92, 0, 'cancelled')
    ])
    expect(result.unpaid).toBe(19.7)
    expect(result.confirmedUnpaid).toBe(11.91)
    expect(result.notReviewedCount).toBe(2)
  })
  it('excludes archived and cancelled bills and never groups different legal partners', () => {
    const other = bill('2026-05-extra', 100, 0, 'confirmed', '百分', '另一家合作方')
    expect(channelPartnerNames([...rows, other], '百分')).toEqual(['另一家合作方', '四川百分网信息科技有限公司'])
    const result = summarizeChannelUnpaid([...rows, other], { partnerName: '四川百分网信息科技有限公司', archivedIds: ['2026-08'] })
    expect(result.unpaid).toBe(28.78)
  })
  it('uses server pool and batch membership before marking rows as cumulative', () => {
    const snap = {
      policy: { enabled: true, settlement_mode: 'threshold' },
      pool: { ready: false, bills: [{ bill_id: '2026-05' }] },
      batches: { items: [{ status: 'invoiced', batch_no: 'CUM-001', items: [{ bill_id: '2026-06' }] }] }
    }
    expect(cumulativeRowCondition(snap,'2026-05')).toMatchObject({kind:'accumulating',label:'累计中'})
    expect(cumulativeRowCondition(snap,'2026-06')).toMatchObject({kind:'batched',label:'已入累计批次'})
    expect(cumulativeRowCondition(snap,'2026-07')).toBeNull()
    expect(cumulativeRowCondition({...snap,policy:{enabled:false,settlement_mode:'threshold'}},'2026-05')).toBeNull()
  })
})
