import { describe, expect, it } from 'vitest'
import {
  hasQuickReconcileDataDifference,
  quickReconcileAssessment,
  quickReconcileCounts,
  quickReconcileEligible,
  quickReconcileLineRows
} from './channelQuickReconcile.js'

const pending = {
  id: '1',
  status: 'pending',
  validationStatus: 'pass',
  settlementDifference: 0,
  items: [{ id: 'l1', gameName: '云上征途', flow: 1000, shareRate: 30, systemSettlementAmount: 300, platformSettlementAmount: 300, settlementDifference: 0, validationStatus: 'pass' }]
}

describe('channel quick reconciliation', () => {
  it('only puts pending bills into the queue', () => {
    expect(quickReconcileEligible(pending)).toBe(true)
    expect(quickReconcileEligible({ ...pending, status: 'confirmed' })).toBe(false)
    expect(quickReconcileEligible({ ...pending, status: 'cancelled' })).toBe(false)
  })

  it('classifies clean checks as pass', () => {
    const state = { loading: false, data: { summary: { fail_count: 0, issue_count: 0, unmatched_count: 0 }, amount_summary: { status: 'pass' } } }
    expect(quickReconcileAssessment(pending, state).tone).toBe('pass')
  })

  it('blocks explicit bill or contract differences', () => {
    const row = { ...pending, settlementDifference: 10, validationStatus: 'fail' }
    expect(hasQuickReconcileDataDifference(row)).toBe(true)
    const state = { loading: false, data: { summary: { fail_count: 1 }, amount_summary: { status: 'fail' } } }
    expect(quickReconcileAssessment(row, state).tone).toBe('danger')
  })

  it('keeps unmatched contract evidence as a warning rather than a hard failure', () => {
    const state = { loading: false, data: { summary: { fail_count: 0, issue_count: 1, unmatched_count: 1 }, amount_summary: { status: 'warning' } } }
    expect(quickReconcileAssessment(pending, state).tone).toBe('warning')
  })

  it('summarizes queue counts and line comparison rows', () => {
    const checks = {
      1: { loading: false, data: { summary: { fail_count: 0, issue_count: 0 }, amount_summary: { status: 'pass' }, lines: [{ line_id: 'l1', status: 'pass', match: { contract_name: '渠道联运合同' }, contract_amount: { expected_amount: 300, actual_amount: 300 } }] } },
      2: { loading: false, error: 'offline' }
    }
    expect(quickReconcileCounts([pending, { ...pending, id: '2' }], checks)).toEqual({ pass: 1, warning: 1, danger: 0, loading: 0 })
    const line = quickReconcileLineRows(pending, checks[1].data)[0]
    expect(line.gameName).toBe('云上征途')
    expect(line.expected).toBe(300)
    expect(line.platform).toBe(300)
    expect(line.status).toBe('pass')
    expect(line.contractName).toBe('渠道联运合同')
  })
})
