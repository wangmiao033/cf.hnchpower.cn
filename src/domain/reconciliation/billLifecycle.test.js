import { describe, expect, it } from 'vitest'
import {
  billStatusLabel,
  isBillLockedStatus,
  lifecycleStepIndex
} from './billLifecycle.js'

describe('bill lifecycle UI helpers', () => {
  it('maps lifecycle status labels', () => {
    expect(billStatusLabel('pending')).toBe('待核对')
    expect(billStatusLabel('confirmed')).toBe('已核对')
    expect(billStatusLabel('reconciled')).toBe('已核销')
  })

  it('locks financial editing after confirmation', () => {
    expect(isBillLockedStatus('draft')).toBe(false)
    expect(isBillLockedStatus('pending')).toBe(false)
    expect(isBillLockedStatus('confirmed')).toBe(true)
    expect(isBillLockedStatus('completed')).toBe(true)
    expect(isBillLockedStatus('cancelled')).toBe(true)
  })

  it('orders normal lifecycle steps and treats cancelled separately', () => {
    expect(lifecycleStepIndex('pending')).toBe(1)
    expect(lifecycleStepIndex('settled')).toBe(4)
    expect(lifecycleStepIndex('cancelled')).toBe(-1)
  })
})
