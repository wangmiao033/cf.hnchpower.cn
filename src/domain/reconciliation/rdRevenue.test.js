import { describe, expect, it } from 'vitest'
import { parseRdRevenue } from './rdRevenue.js'
import { apiRowToFrontend, frontendRecordToApiPayload } from '@/lib/api/reconciliation.ts'
import { normalizeRdDraft, areNormalizedDraftsEqual, isMeaningfulRdDraft } from '@/domain/drafts/billDrafts.js'
import { buildRdMonthlyProgressRecords, rdCompatibilitySettlementMonth } from './rdSettlementPeriods.js'
import { summarizeRdReconciliationProgress } from './rdReconciliationProgress.js'
import { expandRdRecordsForSettlementExport, buildSettlementSheetAoa } from '@/domain/export/settlementConfirmationExport.js'

const line = (gameName, revenue, settlementCycle = '2026年9月') => ({ gameName, revenue, settlementCycle, discountRate: 1, shareRatio: 100, taxRate: 0, couponAmount: 0, testFee: 0, extraFee: 0 })
const record = { id: 'synthetic', partner: '合成研发', settlementMonth: '2026年9月', status: 'pending', channelFeeRate: 0, settlementAmount: 450, items: [line('正数游戏', 450), line('零收入甲', 0), line('零收入乙', '0')] }

describe('explicit zero RD revenue', () => {
  it.each([0, '0', '0.00', ' 0 ', 450, '450.01'])('accepts explicit finite non-negative revenue %s', value => {
    expect(parseRdRevenue(value)).toBe(Number(value))
  })
  it.each(['', ' ', undefined, null, -1, '-0.01', 'abc', '12abc', '0x10', NaN, Infinity, 'Infinity', true, [], {}])('rejects missing or invalid revenue %s before API conversion', value => {
    expect(parseRdRevenue(value)).toBeNull()
    expect(() => frontendRecordToApiPayload({ ...record, items: [line('游戏', value)] })).toThrow('后台流水')
  })
  it('preserves zero through payload, detail/list mapping, monthly progress and Excel rows', () => {
    const payload = frontendRecordToApiPayload(record)
    const restored = apiRowToFrontend({ ...payload, id: record.id, items: payload.items.map((item, index) => ({ ...item, id: String(index), settlement_amount: item.revenue })) })
    expect(restored.items.map(item => item.revenue)).toEqual(['450', '0', '0'])
    expect(restored.status).toBe('pending')
    expect(restored.settlementAmount).toBe('450.00')
    const monthly = buildRdMonthlyProgressRecords([restored], '2026-09')
    expect(monthly[0].items).toHaveLength(3)
    const progress = summarizeRdReconciliationProgress(monthly)
    expect(progress.rows[0]).toMatchObject({ hasFlow: true, reconciled: false, paid: false, reason: '待核对', settlementAmount: 450 })
    expect(progress.rows[0].product).toContain('零收入甲、零收入乙')
    const exported = expandRdRecordsForSettlementExport([restored])
    expect(exported.map(item => item.revenue)).toEqual([450, 0, 0])
    expect(exported.reduce((sum, item) => sum + item.settlementAmount, 0)).toBe(450)
    expect(JSON.stringify(buildSettlementSheetAoa([restored]))).toContain('零收入甲')
  })
  it('counts zero-only months as recorded, without confirming or marking paid', () => {
    const zero = { ...record, settlementAmount: 0, items: [line('零收入甲', 0, '2026年8月')] }
    expect(rdCompatibilitySettlementMonth(zero.items, record.settlementMonth)).toBe('2026年8月')
    const monthly = buildRdMonthlyProgressRecords([zero], '2026-08')
    const progress = summarizeRdReconciliationProgress(monthly)
    expect(progress.totals).toMatchObject({ rows: 1, flowRows: 1, reconciledRows: 0, paidRows: 0, settlementAmount: 0 })
    expect(progress.rows[0].reason).toBe('待核对')
    expect(summarizeRdReconciliationProgress([{ ...zero, items: [line('零收入甲', '')] }]).rows[0].reason).toContain('缺少流水')
  })
  it('keeps blank and invalid drafts distinct from explicit zero', () => {
    const draft = revenue => ({ items: [line('游戏', revenue)] })
    for (const value of ['', undefined, null, 'abc']) {
      expect(areNormalizedDraftsEqual(draft(value), draft(0), normalizeRdDraft)).toBe(false)
    }
    expect(areNormalizedDraftsEqual(draft('0.00'), draft(0), normalizeRdDraft)).toBe(true)
    expect(isMeaningfulRdDraft({ items: [{ revenue: '', shareRatio: 15, discountRate: 1 }] })).toBe(false)
  })
})
