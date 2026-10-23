import { describe, expect, it } from 'vitest'
import {
  allocateStatementPrepayment,
  describeRdPrepaymentHint,
  resolveRdPrepaymentPreview
} from './rdPrepaymentPreview.js'

describe('rd statement prepayment preview', () => {
  it('turns the Longyin January statement balance into cash payable', () => {
    const preview = resolveRdPrepaymentPreview({
      settlement: 4317.6,
      statementAmount: '436.07'
    })
    expect(preview.deduction).toBe(436.07)
    expect(preview.actualPayable).toBe(3881.53)
    expect(preview.source).toBe('statement')
    expect(allocateStatementPrepayment([4026, 144.15, 147.45], preview.deduction)).toEqual([
      436.07,
      0,
      0
    ])
  })

  it('keeps the contract deduction until the statement balance is edited', () => {
    const preview = resolveRdPrepaymentPreview({
      settlement: 4317.6,
      contractDeduction: 436.07,
      statementAmount: null
    })
    expect(preview.source).toBe('contract')
    expect(preview.actualPayable).toBe(3881.53)
  })

  it('does not deduct more than the R&D settlement', () => {
    const preview = resolveRdPrepaymentPreview({
      settlement: 100,
      statementAmount: '436.07'
    })
    expect(preview.deduction).toBe(100)
    expect(preview.actualPayable).toBe(0)
    expect(preview.capped).toBe(true)
  })

  it('explains when the contract has no usable prepayment', () => {
    const preview = resolveRdPrepaymentPreview({ settlement: 4317.6 })
    expect(describeRdPrepaymentHint(preview)).toContain('没有可用预付款')
  })
})
