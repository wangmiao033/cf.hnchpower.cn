import { describe, expect, it } from 'vitest'
import { buildBillClosureStatus, listFundingClosureStatus } from './closureStatus.js'

describe('V4 bill closure status', () => {
  it('marks a fully covered and settled bill as closed', () => {
    const result = buildBillClosureStatus({
      record: { status: 'confirmed' },
      summary: { unpaidAmount: 0, paidAmount: 6485.22, isZeroSettlement: false },
      invoiceSummary: { coverage_status: 'complete', remaining_amount: 0 },
      contracts: [{ timeline_status: '生效中' }]
    })
    expect(result.state).toBe('closed')
    expect(result.label).toBe('已完全闭环')
    expect(result.completed).toBe(4)
  })

  it('keeps partial funding visible as attention instead of completed', () => {
    const result = buildBillClosureStatus({
      record: { status: 'confirmed' },
      summary: { unpaidAmount: 300, paidAmount: 700, isZeroSettlement: false },
      invoiceSummary: { coverage_status: 'complete', remaining_amount: 0 },
      contracts: [{ timeline_status: '生效中' }]
    })
    expect(result.state).toBe('attention')
    expect(result.stages.find((stage) => stage.key === 'funding')).toMatchObject({
      tone: 'warning',
      title: '部分结算'
    })
  })

  it('treats invoice over-allocation as a blocking issue', () => {
    const result = buildBillClosureStatus({
      record: { status: 'confirmed' },
      summary: { unpaidAmount: 0, paidAmount: 100, isZeroSettlement: false },
      invoiceSummary: { coverage_status: 'over', remaining_amount: 0 },
      contracts: [{ timeline_status: '生效中' }]
    })
    expect(result.state).toBe('blocked')
    expect(result.stages.find((stage) => stage.key === 'invoice').tone).toBe('blocked')
  })

  it('zero-settlement skips invoice and funding actions', () => {
    const result = buildBillClosureStatus({
      record: { status: 'confirmed' },
      summary: { unpaidAmount: 0, paidAmount: 0, isZeroSettlement: true },
      invoiceSummary: null,
      contracts: [{ timeline_status: '生效中' }]
    })
    expect(result.stages.find((stage) => stage.key === 'invoice').title).toBe('无需开票')
    expect(result.stages.find((stage) => stage.key === 'funding').title).toBe('无需资金动作')
    expect(result.state).toBe('closed')
  })
})

describe('list funding closure status', () => {
  it('shows unpaid confirmed channel bills as pending funding', () => {
    expect(listFundingClosureStatus({ amount: 1000, paid: 0, lifecycleStatus: 'confirmed' })).toMatchObject({
      tone: 'pending',
      label: '待资金结算'
    })
  })

  it('shows fully settled bills as closed', () => {
    expect(listFundingClosureStatus({ amount: 1000, paid: 1000, lifecycleStatus: 'confirmed' })).toMatchObject({
      tone: 'closed',
      label: '资金已结清'
    })
  })
})
