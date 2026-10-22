import { linesWithChannelLineContractFees } from './channelLineContractFee.js'
import { describe, it, expect } from 'vitest'
import { isAiquChannel, applyRevenueBasisChange, previewRevenueBasisChange } from './channelRevenueBasis.js'
import { initialLineItem, buildFullChannelRecord, recordToLineForms, calculateSettlementDetails } from './channelBillingForm.js'
import { getChannelTotals } from './channelAggregates.js'
import { normalizeChannelDraft } from '../drafts/billDrafts.js'
import { apiChannelRowToFrontend, frontendChannelRecordToPayload } from '../../lib/api/channel.ts'
const header = { channelName: '爱趣', partnerName: '昆山爱趣网络科技有限公司', settlementMonth: '2026-07', channelFeeMode: 'percent', channelFeeRate: 5, taxMode: 'none', settlementRuleCode: 'five_percent_gateway_share' }
const row = { ...initialLineItem(), gameName: '测试游戏0.05折', flow: 1000, discountFactor: .005, shareRate: 25, taxRate: 0, voucherDirectCost: 20, voucherFaceValue: null, testCost: 10, refundCost: 5 }
describe('爱趣独立流水口径', () => {
 it('never changes contractual fees just to match platform money', () => {
  const line = { ...row, revenueBasis: 'post_discount', voucherDirectCost: 0, testCost: 0, refundCost: 0, platformSettlementAmount: 250 }
  const [resolved] = linesWithChannelLineContractFees([line], header)
  expect(calculateSettlementDetails(resolved, header)).toMatchObject({ systemSettlementAmount: 237.5, settlementDifference: -12.5, validationStatus: 'fail' })
 })
 it('exact identity only; unrelated alias and different legal entity fail closed', () => {
  expect(isAiquChannel(header)).toBe(true)
  expect(isAiquChannel({ ...header, channelName: '爱趣（爱趣聚合）' })).toBe(true)
  for (const invalid of [{ ...header, channelName: '爱趣聚合' }, { ...header, partnerName: '其他公司' }]) {
   expect(() => applyRevenueBasisChange(row, 'post_discount', invalid)).toThrow()
   expect(() => calculateSettlementDetails({ ...row, revenueBasis: 'post_discount' }, invalid)).toThrow()
  }
 })
 it('preview preserves monetary input and discount version; only explicit apply changes basis', () => {
  const before = JSON.stringify(row)
  const preview = previewRevenueBasisChange(row, 'post_discount', header)
  expect(preview.beforeEffectiveFlow).toBe(5)
  expect(preview.afterEffectiveFlow).toBe(1000)
  expect(JSON.stringify(row)).toBe(before)
  expect(applyRevenueBasisChange(row, 'post_discount', header)).toEqual({ ...row, revenueBasis: 'post_discount' })
 })
 it('post-discount flow, direct vouchers and actual test fees are not discounted twice', () => {
  const line = { ...row, revenueBasis: 'post_discount' }
  // (1000 - 20 - 10 - 5) * 25% * 95%
  expect(calculateSettlementDetails(line, header).systemSettlementAmount).toBe(229.19)
  expect(buildFullChannelRecord(header, [line]).flow).toBe(1000)
 })
 it('explicit raw voucher remains raw and converts exactly once independent of flow basis', () => {
  const line = { ...row, revenueBasis: 'post_discount', voucherFaceValue: 4000, voucherDirectCost: null }
  expect(previewRevenueBasisChange(line, 'post_discount', header).requiresVoucherReview).toBe(true)
  expect(calculateSettlementDetails(line, header).systemSettlementAmount).toBe(229.19)
 })
 it('old missing-basis records are never automatically reinterpreted, including confirmed records', () => {
  const old = { ...header, status: 'confirmed', receivedAmount: 1, items: [row] }
  expect(recordToLineForms(old)[0].revenueBasis).toBe('pre_discount')
  expect(recordToLineForms(old)[0].flow).toBe('1000')
  expect(getChannelTotals(old).flow).toBe(5)
 })
 it('non-Aiqu old arithmetic remains unchanged', () => {
  expect(calculateSettlementDetails({ ...row, flow: 200000 }, { ...header, channelName: '其他' }).systemSettlementAmount).toBe(229.19)
 })
 it('repeat save/reopen preserves basis, amount, voucher mode and version without reconversion', () => {
  let record = buildFullChannelRecord(header, [{ ...row, revenueBasis: 'post_discount' }])
  for (let i = 0; i < 3; i++) {
   const payload = frontendChannelRecordToPayload(record)
   expect(payload.items[0].revenue_basis).toBe('post_discount')
   const reopened = apiChannelRowToFrontend({ ...payload, items: payload.items })
   record = buildFullChannelRecord(reopened, recordToLineForms(reopened))
   expect(record.flow).toBe(1000)
   expect(record.items[0].discountFactor).toBe(.005)
   expect(record.items[0].voucherDirectCost).toBe(20)
   expect(record.systemSettlementAmount).toBe(229.19)
  }
  expect(normalizeChannelDraft(record).items[0]).toMatchObject({ revenueBasis: 'post_discount', voucherDirectCost: 20, voucherFaceValue: null })
 })
})
