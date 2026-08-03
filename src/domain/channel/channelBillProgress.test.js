import { describe, expect, it } from 'vitest'
import { summarizeChannelBillProgress } from './channelBillProgress.js'

describe('channel bill progress', () => {
  it('uses channel bills as the only source for channel progress', () => {
    const summary = summarizeChannelBillProgress(
      [
        {
          id: 'ch-1',
          settlementMonth: '2026-06',
          channelShortName: '三七三三',
          partnerName: '厦门三七三三网络科技有限公司',
          status: 'pending',
          items: []
        }
      ],
      { month: '2026-06' }
    )

    expect(summary.source).toBe('channel-bills')
    expect(summary.totals.rows).toBe(1)
    expect(summary.totals.reconciledRows).toBe(0)
    expect(summary.totals.unresolvedRows).toBe(1)
    expect(summary.totals.sourceFlow).toBe(0)
    expect(summary.unresolved[0].channel).toBe('三七三三')
  })

  it('ignores bills outside the selected month', () => {
    const summary = summarizeChannelBillProgress(
      [
        { id: 'june', settlementMonth: '2026年6月', status: 'pending', items: [] },
        { id: 'may', settlementMonth: '2026-05', status: 'pending', items: [] }
      ],
      { month: '2026-06' }
    )

    expect(summary.totals.rows).toBe(1)
    expect(summary.unresolved[0].id).toBe('june')
  })
})
