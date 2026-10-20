import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ContractDifferenceActionPanel from '@/components/reconciliation/ContractDifferenceActionPanel.jsx'
import { differenceAmountPresentation } from './differenceAmountPresentation.js'
import { buildContractDifferenceBlockedMessage, isRateOnlyLineContractFailure, isRateOnlyUnresolvedContractCase } from '@/lib/api/billLifecycle.ts'

const reference = { status: 'manual', deterministic: false, expected_amount: 376,
  actual_amount: 21.55, variance_abs: 354.45, variance_direction: 'under' }
const fee = { key: 'channel_fee_rate', label: '渠道费率', status: 'fail', bill_value: 0, contract_value: 5 }
const item = { id: 'case', line_id: 'line', status: 'pending', game_name: '测试游戏', settlement_cycle: '2026-08',
  expected_amount: 376, actual_amount: 21.55, variance_abs: 354.45, variance_direction: 'under',
  source_snapshot: { contract_amount: reference, checks: [fee] } }
const render = (record) => renderToStaticMarkup(React.createElement(ContractDifferenceActionPanel,
  { billType: 'channel', billId: 'bill', initialItems: [record] }))

describe('reference contract amount presentation', () => {
  it('keeps a real fee mismatch visible without calling a manual reference money owed', () => {
    const message = buildContractDifferenceBlockedMessage(1, [item])
    expect(message).toContain('渠道费率：账单 0 / 合同 5')
    expect(message).toContain('合同参考金额（非应结依据） ¥376.00')
    expect(message).toContain('合同核对未通过')
    expect(message).not.toContain('合同应结')
    expect(message).not.toContain('少结 ¥354.45')
    const html = render(item)
    expect(html).toContain('渠道费率：账单 0 / 合同 5')
    expect(html).toContain('合同参考金额（非应结依据）')
    expect(html).not.toContain('合同应结')
    expect(html).not.toContain('少结 ¥354.45')
    expect(html).toContain('disabled="">生成补差项')
    expect(html).toContain('disabled="">转下月冲抵')
  })

  it('explains reference-only and missing amounts as pending verification, never zero or owed', () => {
    const record = { ...item, source_snapshot: { contract_amount: { ...reference, expected_amount: null }, checks: [] } }
    const message = buildContractDifferenceBlockedMessage(1, [record])
    expect(message).toContain('金额尚待人工核验')
    expect(message).toContain('合同参考金额（非应结依据） -')
    expect(message).not.toContain('¥0.00')
    expect(render(record)).not.toContain('¥0.00')
  })

  it('prefers current calculation and fields over stale case values and snapshot', () => {
    const current = { line_id: 'line', contract_amount: { ...reference, status: 'fail', deterministic: true,
      expected_amount: 100, actual_amount: 90, variance_abs: 10 }, checks: [] }
    const message = buildContractDifferenceBlockedMessage(1, [item], { lines: [current] })
    expect(message).toContain('合同应结 ¥100.00，账单实际 ¥90.00，少结 ¥10.00')
    expect(message).not.toContain('参考金额')
    expect(message).not.toContain('渠道费率')
    expect(message).not.toContain('¥376.00')
    const manualCurrent = { ...current, contract_amount: reference, checks: [fee] }
    const old = { ...item, source_snapshot: { contract_amount: current.contract_amount } }
    expect(buildContractDifferenceBlockedMessage(1, [old], { lines: [manualCurrent] })).toContain('合同参考金额')
  })

  it('handles reference calculations even if status is fail and no case is available', () => {
    const message = buildContractDifferenceBlockedMessage(1, [], { lines: [{ line_id: 'line', status: 'fail',
      contract_amount: { ...reference, status: 'fail' }, checks: [fee] }] })
    expect(message).toContain('渠道费率：账单 0 / 合同 5')
    expect(message).toContain('合同参考金额')
    expect(message).not.toContain('合同应结')
  })

  it('does not treat equal reference values as verified rate-only alignment', () => {
    for (const metadata of [{ status: 'manual' }, { status: 'fail', deterministic: false }]) {
      const amount = { ...metadata, expected_amount: 0, actual_amount: 0 }
      expect(isRateOnlyLineContractFailure({ contract_amount: amount, checks: [fee] })).toBe(false)
      expect(isRateOnlyUnresolvedContractCase({ ...item, expected_amount: 0, actual_amount: 0,
        variance_abs: 0, difference_amount: 0, source_snapshot: { contract_amount: amount, checks: [fee] } })).toBe(false)
    }
    expect(isRateOnlyUnresolvedContractCase({ ...item, expected_amount: 0, actual_amount: 0,
      variance_abs: 0, source_snapshot: undefined, amount_is_reference: true })).toBe(false)
  })

  it('supports server flags without snapshot and preserves legacy without inventing certainty', () => {
    const legacy = { ...item, source_snapshot: undefined }
    expect(differenceAmountPresentation(legacy).isReference).toBe(false)
    expect(buildContractDifferenceBlockedMessage(1, [legacy])).toContain('少结 ¥354.45')
    expect(render(legacy)).toContain('合同应结')
    expect(render({ ...legacy, amount_is_reference: true })).toContain('合同参考金额')
    expect(differenceAmountPresentation({ ...legacy, amount_certainty: 'reference' }).isReference).toBe(true)
  })
})
