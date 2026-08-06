import { describe, expect, it } from 'vitest'
import {
  dateToInputValue,
  inheritRdSettlementCycle,
  monthInputValueToSettlementCycle,
  settlementCycleToMonthInputValue,
  summarizeRdFormPeriods
} from './rdDateInputs.js'

describe('research bill date inputs', () => {
  it('converts stored settlement periods to native month values and back', () => {
    expect(settlementCycleToMonthInputValue('2026年8月')).toBe('2026-08')
    expect(settlementCycleToMonthInputValue('2026-05')).toBe('2026-05')
    expect(monthInputValueToSettlementCycle('2026-06')).toBe('2026年6月')
  })

  it('formats the issue date as a native date value', () => {
    expect(dateToInputValue('2026-08-06T12:00:00+08:00')).toBe('2026-08-06')
  })

  it('inherits the most recent line period when adding a row', () => {
    expect(
      inheritRdSettlementCycle(
        [
          { settlementCycle: '2026年5月' },
          { settlementCycle: '2026年6月' }
        ],
        '2026年8月'
      )
    ).toBe('2026年6月')
  })

  it('summarizes continuous and non-continuous bill periods', () => {
    expect(
      summarizeRdFormPeriods([
        { settlementCycle: '2026年5月' },
        { settlementCycle: '2026年6月' }
      ])
    ).toMatchObject({ count: 2, label: '2026年5月—2026年6月' })

    expect(
      summarizeRdFormPeriods([
        { settlementCycle: '2026年5月' },
        { settlementCycle: '2026年7月' }
      ])
    ).toMatchObject({ count: 2, label: '2026年5月、2026年7月' })
  })
})
