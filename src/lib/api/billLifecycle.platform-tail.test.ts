import { describe, expect, it } from 'vitest'

import {
  countBlockingContractFailures,
  isRateOnlyLineContractFailure,
  isRateOnlyUnresolvedContractCase
} from './billLifecycle.ts'

describe('platform tail contract preflight', () => {
  it('treats amount-aligned channel fee mismatch as non-blocking metadata', () => {
    const line = {
      line_id: 'line-1',
      game_name: '云上征途0.05折',
      settlement_cycle: '2026-08',
      status: 'fail',
      contract_amount: {
        status: 'pass',
        expected_amount: 7.73,
        actual_amount: 7.73
      },
      checks: [
        {
          key: 'channel_fee_rate',
          label: '渠道费率',
          status: 'fail',
          bill_value: 0,
          contract_value: 5
        }
      ]
    } as any

    expect(isRateOnlyLineContractFailure(line)).toBe(true)
    expect(countBlockingContractFailures({ lines: [line], bill_checks: [] } as any)).toBe(0)
  })

  it('keeps genuine monetary contract differences blocking', () => {
    const line = {
      line_id: 'line-2',
      status: 'fail',
      contract_amount: { status: 'fail', expected_amount: 400, actual_amount: 444.6 },
      checks: [{ key: 'share_rate', status: 'fail', bill_value: 30, contract_value: 25 }]
    } as any

    expect(isRateOnlyLineContractFailure(line)).toBe(false)
    expect(countBlockingContractFailures({ lines: [line], bill_checks: [] } as any)).toBe(1)
  })

  it('waives pending rate-only difference cases for platform tail', () => {
    const pending = {
      status: 'pending',
      expected_amount: 7.73,
      actual_amount: 7.73,
      difference_amount: 0,
      source_snapshot: {
        checks: [{ key: 'channel_fee_rate', status: 'fail', bill_value: 0, contract_value: 5 }]
      }
    } as any

    expect(isRateOnlyUnresolvedContractCase(pending)).toBe(true)
  })
})
