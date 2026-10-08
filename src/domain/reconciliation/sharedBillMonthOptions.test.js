import { describe, expect, it } from 'vitest'
import {
  channelBillMonths,
  channelBillMonthOptions,
  sharedBillMonthOptions
} from './sharedBillMonthOptions.js'
import { summarizeChannelBillProgress } from '@/domain/channel/channelBillProgress.js'

describe('研发和渠道账单共用可选月份', () => {
  const channelBills = [{
    id: 'channel-july',
    settlementMonth: '2026年7月',
    status: 'confirmed',
    items: [{ settlementCycle: '2026年7月', settlementAmount: 300 }]
  }]
  const researchBills = [{
    id: 'rd-july-august',
    settlementMonth: '2026年7月',
    items: [
      { settlementCycle: '2026年7月', gameName: '游戏A', revenue: 200 },
      { settlementCycle: '2026年8月', gameName: '游戏B', revenue: 400 }
    ]
  }]

  it('shows August in the channel month dropdown even if only research bills exist', () => {
    expect(channelBillMonthOptions(channelBills)).toEqual(['2026-07'])
    expect(sharedBillMonthOptions(channelBills, researchBills)).toEqual(['2026-08', '2026-07'])
  })

  it('does not treat research bills as channel receivables', () => {
    const august = summarizeChannelBillProgress(channelBills, { month: '2026-08' })
    expect(august.totals.rows).toBe(0)
    expect(august.totals.settlementAmount).toBe(0)
    expect(august.totals.receivedAmount).toBe(0)
  })

  it('keeps channel line periods and never invents phantom header months', () => {
    const monthly = {
      settlementMonth: '2026年5月',
      items: [
        { settlementCycle: '2026年7月' },
        { settlementCycle: '2026年8月' },
        { settlementCycle: '2026年8月' }
      ]
    }
    expect(channelBillMonths(monthly)).toEqual(['2026-07', '2026-08'])
    expect(channelBillMonthOptions([monthly])).toEqual(['2026-08', '2026-07'])
  })

  it('deduplicates, sorts, and supports both year-month formats', () => {
    const channels = [{ settlementMonth: '2026-08' }, { settlementMonth: '2026年6月' }]
    const research = [{ settlementMonth: '2026年7月' }, { settlementMonth: '2026年8月' }]
    expect(sharedBillMonthOptions(channels, research)).toEqual(['2026-08', '2026-07', '2026-06'])
  })

  it('does not fabricate a record when neither data source contains a month', () => {
    expect(sharedBillMonthOptions([], [])).toEqual([])
    expect(sharedBillMonthOptions(channelBills, [])).toEqual(['2026-07'])
  })
})
