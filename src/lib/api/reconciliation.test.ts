import { describe, expect, it } from 'vitest'
import {
  apiRowToFrontend,
  frontendRecordToApiPayload
} from '@/lib/api/reconciliation.ts'

const apiRow = {
  id: 'recon-1',
  statement_no: 'JS-001',
  settlement_month: '2026年6月',
  partner_id: 'partner-1',
  partner_name: '广州示例网络科技有限公司',
  partner_short_name: '示例',
  partner_link_status: 'linked' as const,
  game_name: '示例游戏',
  game_flow: 100,
  test_cost: 0,
  voucher_cost: 0,
  channel_fee_rate: 5,
  tax_rate: 0,
  revenue_share_rate: 20,
  discount_value: 1,
  refund_amount: 0,
  settlement_amount: 19,
  status: 'confirmed',
  remark: null,
  created_at: '2026-07-26T00:00:00Z',
  updated_at: '2026-07-26T00:00:00Z'
}

describe('reconciliation customer linkage mapping', () => {
  it('keeps the linked customer id and short name from the API', () => {
    expect(apiRowToFrontend(apiRow)).toMatchObject({
      partnerId: 'partner-1',
      partner: '广州示例网络科技有限公司',
      partnerShortName: '示例',
      partnerLinkStatus: 'linked'
    })
  })

  it('sends the customer id together with the compatibility name field', () => {
    expect(
      frontendRecordToApiPayload({
        settlementNumber: 'JS-001',
        settlementMonth: '2026年6月',
        partnerId: 'partner-1',
        partner: '广州示例网络科技有限公司',
        game: '示例游戏',
        gameFlow: '100',
        testingFee: '0',
        voucher: '0',
        channelFeeRate: '5',
        taxPoint: '0',
        revenueShareRatio: '20',
        discount: '1',
        refund: '0',
        settlementAmount: '19',
        status: 'confirmed'
      })
    ).toMatchObject({
      partner_id: 'partner-1',
      partner_name: '广州示例网络科技有限公司'
    })
  })
})
