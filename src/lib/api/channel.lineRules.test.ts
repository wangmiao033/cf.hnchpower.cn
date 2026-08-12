import { describe, expect, it } from 'vitest'
import { apiChannelRowToFrontend, frontendChannelRecordToPayload } from './channel.ts'

describe('channel per-line contract rule REST round-trip', () => {
  it('preserves a 6% line fee even when the bill header is 0%', () => {
    const frontend = apiChannelRowToFrontend({
      id: 'bill-1',
      statement_no: 'QD-202601-001',
      channel_name: '厦门游戏之家',
      partner_name: '厦门游戏之家科技有限公司',
      game_name: '龙吟大陆、圣树唤歌',
      settlement_month: '2026-01',
      start_date: '2026-01-01',
      end_date: '2026-01-31',
      billing_flow: 2000,
      voucher_cost: 0,
      no_worry_cost: 0,
      refund_cost: 0,
      test_cost: 0,
      welfare_cost: 0,
      coin_cost: 0,
      share_rate: 30,
      billing_amount: 2000,
      share_amount: 600,
      tax_rate: 0,
      gateway_cost: 0,
      settlement_amount: 582,
      received_amount: 0,
      receipt_status: 'unpaid',
      status: 'pending',
      remark: null,
      server_cost: null,
      discount_type: null,
      channel_fee_rate: 0,
      dev_share_rate: null,
      profit_rate: null,
      settlement_rule_code: 'share_only',
      channel_fee_mode: 'none',
      tax_mode: 'none',
      validation_tolerance: 0.05,
      system_settlement_amount: 582,
      platform_settlement_amount: null,
      settlement_difference: null,
      validation_status: 'unvalidated',
      created_at: '2026-08-12T00:00:00Z',
      updated_at: '2026-08-12T00:00:00Z',
      items: [
        {
          id: 'line-1',
          channel_record_id: 'bill-1',
          sort_order: 0,
          settlement_cycle: '2026-01',
          game_name: '圣树唤歌',
          billing_flow: 1000,
          discount_factor: 1,
          voucher_cost: 0,
          no_worry_cost: 0,
          refund_cost: 0,
          test_cost: 0,
          welfare_cost: 0,
          coin_cost: 0,
          share_rate: 30,
          billing_amount: 1000,
          share_amount: 300,
          tax_rate: 0,
          gateway_cost: 0,
          settlement_rule_code: 'custom',
          channel_fee_mode: 'percent',
          channel_fee_rate: 6,
          tax_mode: 'none',
          validation_tolerance: 0.05,
          platform_settlement_amount: null,
          system_settlement_amount: 282,
          settlement_difference: null,
          validation_status: 'unvalidated',
          settlement_amount: 282,
          created_at: '2026-08-12T00:00:00Z',
          updated_at: '2026-08-12T00:00:00Z'
        }
      ]
    })

    const line = (frontend.items as Record<string, unknown>[])[0]
    expect(line.channelFeeMode).toBe('percent')
    expect(line.channelFeeRate).toBe(6)
    expect(line.settlementRuleCode).toBe('custom')

    const payload = frontendChannelRecordToPayload(frontend)
    expect(payload.items[0].channel_fee_mode).toBe('percent')
    expect(payload.items[0].channel_fee_rate).toBe(6)
    expect(payload.items[0].settlement_rule_code).toBe('custom')
    expect(payload.items[0].tax_mode).toBe('none')
  })
})
