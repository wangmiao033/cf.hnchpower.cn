import { describe, expect, it } from 'vitest'
import { getChannelBillNumber } from './channelBillNumber.js'

describe('getChannelBillNumber', () => {
  it('keeps an existing persisted number', () => {
    expect(getChannelBillNumber({ billNumber: 'QD-20260727-001' })).toBe('QD-20260727-001')
  })

  it('creates a stable number from creation date and id', () => {
    const record = {
      id: '12345678-abcd-4def-9012-abcdef123456',
      createdAt: '2026-07-27T08:30:00Z'
    }
    expect(getChannelBillNumber(record)).toBe('QD-20260727-123456')
    expect(getChannelBillNumber(record)).toBe('QD-20260727-123456')
  })

  it('falls back to settlement month for local records', () => {
    expect(getChannelBillNumber({ id: 1720000123456, settlementMonth: '2026年6月' }))
      .toBe('QD-20260601-123456')
  })
})
