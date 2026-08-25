import { describe, expect, it } from 'vitest'

import { buildContractDifferenceBlockedMessage } from './billLifecycle.ts'

describe('contract difference confirmation message', () => {
  it('shows the exact game, period and amount from difference cases', () => {
    const message = buildContractDifferenceBlockedMessage(
      1,
      [
        {
          id: 'case-1',
          bill_type: 'channel',
          bill_id: 'bill-1',
          line_id: 'line-1',
          contract_name: '渠道合同',
          contract_no: 'HT-001',
          statement_no: 'QD-001',
          partner_name: '测试渠道',
          game_name: '云上征途（0.1折齐天伏魔）',
          settlement_cycle: '2025-08',
          expected_amount: 376,
          actual_amount: 21.55,
          difference_amount: 354.45,
          variance_abs: 354.45,
          variance_direction: 'under',
          status: 'pending',
          handling_type: null,
          substatus: '',
          reason_type: '',
          description: '',
          owner: '',
          evidence: [],
          created_by: '',
          created_at: null,
          updated_by: '',
          updated_at: null,
          resolved_at: null
        }
      ] as any,
      null
    )

    expect(message).toContain('云上征途（0.1折齐天伏魔）（2025-08）')
    expect(message).toContain('合同应结 ¥376.00')
    expect(message).toContain('账单实际 ¥21.55')
    expect(message).toContain('少结 ¥354.45')
    expect(message).toContain('请直接修改上述明细')
  })

  it('falls back to failed contract fields when no difference case is available', () => {
    const message = buildContractDifferenceBlockedMessage(
      1,
      [],
      {
        lines: [
          {
            line_id: 'line-1',
            game_name: '测试游戏',
            settlement_cycle: '2025-08',
            status: 'fail',
            match: null,
            candidates: [],
            message: '费率不一致',
            checks: [
              {
                key: 'share_rate',
                label: '分成比例',
                status: 'fail',
                bill_value: 30,
                contract_value: 22,
                difference: 8,
                message: '分成比例不一致'
              }
            ]
          }
        ]
      } as any
    )

    expect(message).toContain('测试游戏（2025-08）')
    expect(message).toContain('分成比例：账单 30 / 合同 22')
  })
})
