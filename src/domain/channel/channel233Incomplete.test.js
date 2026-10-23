import { describe, expect, it, vi } from 'vitest'
import { INCOMPLETE_233, LEGAL_NAME_233, is233Customer, incomplete233Fields, incomplete233Validation } from './channel233Incomplete.js'
import { buildFullChannelRecord, recordToHeaderForm, recordToLineForms } from './channelBillingForm.js'
import { frontendChannelRecordToPayload, apiChannelRowToFrontend } from '@/lib/api/channel.ts'
import { applyContractRecommendation, resolveChannelContractAuthority } from './channelRuleAuthority.js'
import { describeChannelDifference } from './channelDifferenceReview.js'
import { writeBillDraft, readBillDraft } from '@/domain/drafts/billDrafts.js'

const header = { partnerName: LEGAL_NAME_233, channelName: '龙威233', settlementMonth: '2026-06', status: 'pending', ...incomplete233Fields() }
const line = { gameName: '合成游戏', settlementCycle: '2026-06', flow: '', shareRate: '', taxRate: '', refundCost: 5.34, platformSettlementAmount: '-5.34' }
describe('233 explicit incomplete draft', () => {
  it('retains actual negative platform settlement with unknown operands through REST roundtrip', () => {
    const built = buildFullChannelRecord(header, [line])
    expect(built).toMatchObject({ settlementAmount: -5.34, validationStatus: 'incomplete', settlementDifference: null })
    const payload = frontendChannelRecordToPayload(built)
    expect(payload.items[0]).toMatchObject({ billing_flow: 0, share_rate: 0, settlement_rule_code: INCOMPLETE_233, platform_settlement_amount: -5.34 })
    const restored = apiChannelRowToFrontend({ ...payload, id: 'fake', items: payload.items })
    expect(recordToLineForms(restored)[0]).toMatchObject({ flow: '', shareRate: '', taxRate: '', platformSettlementAmount: '-5.34' })
    expect(buildFullChannelRecord(recordToHeaderForm(restored), recordToLineForms(restored)).validationStatus).toBe('incomplete')
    expect(describeChannelDifference(built).kind).toBe('unvalidated')
  })
  it('zero never becomes agreement and a missing platform amount is rejected', () => {
    expect(buildFullChannelRecord(header, [{ ...line, platformSettlementAmount: 0 }]).validationStatus).toBe('incomplete')
    expect(incomplete233Validation(header, [{ ...line, platformSettlementAmount: '' }])).toContain('真实平台结算')
    expect(incomplete233Validation(header, [line], 'confirm')).toContain('资料未齐')
  })
  it('only the verified company and exact channel see the opt-in', () => {
    expect(is233Customer(header)).toBe(true)
    expect(is233Customer({ ...header, channelName: '233' })).toBe(false)
    expect(is233Customer({ ...header, partnerName: '其他公司' })).toBe(false)
  })
  it('contract refresh cannot overwrite missing data or calculate a rate', async () => {
    const record = buildFullChannelRecord(header, [line])
    expect(applyContractRecommendation(record, { lines: [{ line_index: 0, auto_apply: true, recommended: { share_rate: 100 } }] }).record).toEqual(record)
    expect((await resolveChannelContractAuthority(record)).record).toEqual(record)
  })
  it('local draft restore preserves the missing marker and actual amount', () => {
    const storage = new Map()
    vi.stubGlobal('window', { localStorage: { setItem: (key,value) => storage.set(key,value), getItem: key => storage.get(key) } })
    try {
      writeBillDraft('synthetic-233', buildFullChannelRecord(header, [line]))
      const draft = readBillDraft('synthetic-233').record
      expect(recordToLineForms(draft)[0].shareRate).toBe('')
      expect(buildFullChannelRecord(recordToHeaderForm(draft), recordToLineForms(draft)).settlementAmount).toBe(-5.34)
    } finally { vi.unstubAllGlobals() }
  })
  it('completion needs explicit inputs and source, and remains pending', () => {
    const completion = { ...header, settlementRuleCode: 'share_only', channelFeeMode: 'none', completeIncompleteDraft: true, incompleteCompletionReason: '合成明细依据' }
    expect(incomplete233Validation(completion, [line])).toContain('不能沿用未知占位')
    const ready = { ...line, flow: 100, shareRate: 50, taxRate: 0, platformSettlementAmount: 50 }
    expect(incomplete233Validation(completion, [ready])).toBe('')
    const payload = frontendChannelRecordToPayload(buildFullChannelRecord(completion, [ready]))
    expect(payload).toMatchObject({ complete_incomplete_draft: true, audit_reason: '合成明细依据', status: 'pending' })
  })
})
