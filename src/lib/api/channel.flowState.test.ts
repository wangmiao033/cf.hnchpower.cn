import { describe, expect, it } from 'vitest'
import { apiChannelRowToFrontend, frontendChannelRecordToPayload } from './channel.ts'

function payloadLine(input: Record<string, unknown>) {
  const payload = frontendChannelRecordToPayload({
    channelName: '测试渠道',
    partnerName: '测试渠道',
    settlementMonth: '2026-08',
    items: [{
      gameName: '测试游戏',
      settlementCycle: '2026-08',
      discountFactor: 1,
      shareRate: 30,
      taxRate: 0,
      ...input
    }]
  })
  return payload.items[0]
}

describe('channel flow input payload state', () => {
  it('keeps blank and implicit zero in missing state', () => {
    expect(payloadLine({ flow: '' }).flow_input_state).toBe('missing')
    expect(payloadLine({ flow: 0 }).flow_input_state).toBe('missing')
  })

  it('only persists zero as complete after explicit confirmation', () => {
    expect(payloadLine({ flow: 0, flowInputState: 'confirmed_zero' }).flow_input_state).toBe('confirmed_zero')
  })

  it('marks positive manual flow as entered', () => {
    expect(payloadLine({ flow: 123.45, flowInputState: 'missing' }).flow_input_state).toBe('entered')
  })

  it('keeps legacy API rows compatible after migration backfill', () => {
    const record = apiChannelRowToFrontend({
      id: 'bill-1',
      statement_no: 'QD-1',
      channel_name: '测试渠道',
      partner_name: '测试渠道',
      game_name: '历史游戏',
      settlement_month: '2026-07',
      start_date: null,
      end_date: null,
      billing_flow: 0,
      voucher_cost: 0,
      no_worry_cost: 0,
      refund_cost: 0,
      test_cost: 0,
      welfare_cost: 0,
      coin_cost: 0,
      share_rate: 30,
      billing_amount: 0,
      share_amount: 0,
      tax_rate: 0,
      gateway_cost: 0,
      settlement_amount: 0,
      received_amount: 0,
      receipt_status: 'unpaid',
      status: 'pending',
      remark: null,
      server_cost: null,
      discount_type: null,
      channel_fee_rate: null,
      dev_share_rate: null,
      profit_rate: null,
      settlement_rule_code: 'share_only',
      channel_fee_mode: 'none',
      tax_mode: 'none',
      validation_tolerance: 0.05,
      system_settlement_amount: 0,
      platform_settlement_amount: null,
      settlement_difference: null,
      validation_status: 'unvalidated',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
      items: [{
        id: 'line-1',
        channel_record_id: 'bill-1',
        sort_order: 0,
        settlement_cycle: '2026-07',
        game_name: '历史游戏',
        billing_flow: 0,
        flow_input_state: 'confirmed',
        discount_factor: 1,
        voucher_cost: 0,
        no_worry_cost: 0,
        refund_cost: 0,
        test_cost: 0,
        welfare_cost: 0,
        coin_cost: 0,
        share_rate: 30,
        billing_amount: 0,
        share_amount: 0,
        tax_rate: 0,
        gateway_cost: 0,
        settlement_rule_code: 'share_only',
        channel_fee_mode: 'none',
        channel_fee_rate: null,
        tax_mode: 'none',
        validation_tolerance: 0.05,
        platform_settlement_amount: null,
        system_settlement_amount: 0,
        settlement_difference: null,
        validation_status: 'unvalidated',
        settlement_amount: 0,
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z'
      }]
    })
    expect((record.items as Array<Record<string, unknown>>)[0].flowInputState).toBe('confirmed_zero')
  })
})
