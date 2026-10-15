import { describe, it, expect } from 'vitest'
import {
  invoiceBuyerMatchesPartner, eligibleInvoicePartnerRows,
  recommendInvoiceBillSet, scannedInvoiceAmountState
} from './channelInvoiceUploadMatch.js'

const legal = '湖南天宇互动网络科技有限公司'
const bill = (id, amount, extra = {}) => ({
  id, partnerName: legal, settlementAmount: amount,
  status: 'confirmed', settlementMonth: '2026-02', ...extra
})

describe('smart scanned channel invoice matching', () => {
  it('treats full legal parties exactly; does not merge brand shorthand or other companies', () => {
    expect(invoiceBuyerMatchesPartner('湖南天宇互动网络科技有限公司', legal)).toBe(true)
    expect(invoiceBuyerMatchesPartner(' 湖南天宇互动网络科技有限公司 ', legal)).toBe(true)
    expect(invoiceBuyerMatchesPartner('天宇游戏', legal)).toBe(false)
    expect(invoiceBuyerMatchesPartner('广州熊动科技有限公司', legal)).toBe(false)
    expect(invoiceBuyerMatchesPartner('', legal)).toBe(false)
  })

  it('does not propose pending, paid-in-full, wrong partner or zero-value bills', () => {
    const result = eligibleInvoicePartnerRows([
      bill('dec', 10, {settlementMonth:'2025-12'}),
      bill('jan', 22, {settlementMonth:'2026-01'}),
      bill('pending', 40, {status:'pending'}),
      bill('wrong', 55, {partnerName:'另一家有限公司'}),
      bill('zero', 0),
      bill('selected', 36.46)
    ], legal, ['selected'])
    expect(result.map(x => x.id)).toEqual(['jan', 'dec'])
  })

  it('suggests the single exact three-month combination rather than booking only February', () => {
    // Screenshot: the user opens February ¥36.46, the original invoice may
    // contain Dec-Feb. The below is an illustrative fixture, not real amounts.
    const selected = [bill('feb', 36.46)]
    const summaries = [{remaining_amount:36.46}]
    const candidate = [
      { id:'dec', remaining_amount:10.12 },
      { id:'jan', remaining_amount:20.22 },
      { id:'mar', remaining_amount:77.77 }
    ]
    expect(recommendInvoiceBillSet(66.80, selected, summaries, candidate)).toEqual({
      ids: ['dec', 'jan'], unique:true, ambiguous:false
    })
  })

  it('stops guessing if different combinations reach the same total', () => {
    const result = recommendInvoiceBillSet(66.46, [bill('feb',36.46)],
      [{remaining_amount:36.46}],[
        {id:'a',remaining_amount:10},
        {id:'b',remaining_amount:20},
        {id:'c',remaining_amount:30}
      ])
    expect(result.ids).toEqual([])
    expect(result.ambiguous).toBe(true)
  })

  it('rejects short, partial and extra invoice amounts until user reviews bill selection', () => {
    expect(scannedInvoiceAmountState(36.46,3646).kind).toBe('match')
    expect(scannedInvoiceAmountState(66.80,3646).kind).toBe('mismatch')
    expect(scannedInvoiceAmountState(12,3646).kind).toBe('mismatch')
    expect(scannedInvoiceAmountState(0,3646).kind).toBe('unreadable')
  })
})
