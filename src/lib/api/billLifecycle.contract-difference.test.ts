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

  it('shows the failed field when amounts are both ¥444.60 rather than a false ¥0.00 difference', () => {
    const message = buildContractDifferenceBlockedMessage(
      1,
      [{
        id: 'case-dragon', line_id: 'dragon', status: 'pending',
        game_name: '龙虎大陆（0.1折正版放置手游）', settlement_cycle: '2026-04',
        expected_amount: 444.60, actual_amount: 444.60, difference_amount: 0,
        variance_abs: 0, variance_direction: 'equal',
        source_snapshot: { checks: [{ key: 'share_rate', label: '分成比例',
          status: 'fail', bill_value: 25, contract_value: 30 }] }
      }] as any,
      { lines: [{
        line_id: 'dragon', game_name: '龙虎大陆（0.1折正版放置手游）',
        settlement_cycle: '2026-04', status: 'fail',
        checks: [{ key: 'channel_fee_rate', label: '渠道费率', status: 'fail',
          bill_value: 5, contract_value: 0 }]
      }] } as any
    )
    expect(message).toContain('渠道费率：账单 5 / 合同 0')
    expect(message).not.toContain('分成比例：账单 25 / 合同 30')
    expect(message).toContain('金额一致 ¥444.60')
    expect(message).not.toContain('差额 ¥0.00')
    expect(message).toContain('请核对合同条款与账单规则')
  })

  it('uses the recorded failed fields if reconciliation has no current line', () => {
    const message = buildContractDifferenceBlockedMessage(
      1,
      [{
        line_id: 'dragon', status: 'pending', game_name: '龙虎大陆',
        settlement_cycle: '2026-04', expected_amount: 444.60, actual_amount: 444.60,
        variance_abs: 0, variance_direction: 'equal',
        source_snapshot: { checks: [{ key: 'tax_rate', label: '税率',
          status: 'fail', bill_value: 0, contract_value: 5 }] }
      }] as any,
      null
    )
    expect(message).toContain('税率：账单 0 / 合同 5')
    expect(message).toContain('金额一致 ¥444.60')
  })

  it('uses a truthful unresolved-contract message instead of a ¥0.00 monetary error', () => {
    const message = buildContractDifferenceBlockedMessage(
      1,
      [{ line_id: 'dragon', status: 'pending', game_name: '龙虎大陆',
        settlement_cycle: '2026-04', expected_amount: 444.60, actual_amount: 444.60,
        variance_abs: 0, variance_direction: 'equal' }] as any,
      null
    )
    expect(message).toContain('金额一致；仍有未关闭的合同差异')
    expect(message).not.toContain('差额 ¥0.00')
  })

  it('keeps genuine monetary differences blocking and names rate mismatches too', () => {
    const message = buildContractDifferenceBlockedMessage(
      1,
      [{ line_id: 'dragon', status: 'pending', game_name: '龙虎大陆',
        settlement_cycle: '2026-04', expected_amount: 400, actual_amount: 444.60,
        variance_abs: 44.60, variance_direction: 'over',
        source_snapshot: { checks: [{ key: 'share_rate', label: '分成比例',
          status: 'fail', bill_value: 30, contract_value: 25 }] }
      }] as any,
      null
    )
    expect(message).toContain('分成比例：账单 30 / 合同 25')
    expect(message).toContain('合同应结 ¥400.00，账单实际 ¥444.60')
    expect(message).toContain('请直接修改上述明细')
  })
})
