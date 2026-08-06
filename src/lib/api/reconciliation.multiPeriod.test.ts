import { describe, expect, it } from 'vitest'
import {
  apiRowToFrontend,
  frontendRecordToApiPayload,
  type ApiReconciliationRow
} from './reconciliation.ts'

describe('research reconciliation multi-period API mapping', () => {
  it('builds one master payload containing two independently dated line items', () => {
    const payload = frontendRecordToApiPayload({
      settlementNumber: 'JS-20260806-001',
      settlementMonth: '2026年5月',
      partnerId: 'partner-1',
      partner: '海南奇趣网络科技有限公司',
      game: '魔法启示录',
      gameFlow: 450,
      testingFee: 0,
      voucher: 0,
      channelFeeRate: 0,
      taxPoint: 0,
      revenueShareRatio: 100,
      discount: 1,
      refund: 0,
      settlementAmount: 450,
      status: 'pending',
      items: [
        {
          settlementCycle: '2026年5月',
          gameName: '魔法启示录',
          revenue: 280,
          discountRate: 1,
          couponAmount: 0,
          testFee: 0,
          extraFee: 0,
          shareRatio: 100,
          taxRate: 0,
          sortOrder: 0
        },
        {
          settlementCycle: '2026年6月',
          gameName: '魔法启示录',
          revenue: 170,
          discountRate: 1,
          couponAmount: 0,
          testFee: 0,
          extraFee: 0,
          shareRatio: 100,
          taxRate: 0,
          sortOrder: 1
        }
      ]
    })

    expect(payload.statement_no).toBe('JS-20260806-001')
    expect(payload.settlement_amount).toBe(450)
    expect(payload.items).toHaveLength(2)
    expect(payload.items?.map((item) => item.settlement_cycle)).toEqual([
      '2026年5月',
      '2026年6月'
    ])
  })

  it('restores both periods after querying and refreshing the edit page', () => {
    const apiRow: ApiReconciliationRow = {
      id: 'bill-1',
      statement_no: 'JS-20260806-001',
      settlement_month: '2026年5月',
      settlement_periods: ['2026年5月', '2026年6月'],
      settlement_period_label: '2026年5月—2026年6月',
      partner_id: 'partner-1',
      partner_name: '海南奇趣网络科技有限公司',
      game_name: '魔法启示录',
      game_flow: 450,
      test_cost: 0,
      voucher_cost: 0,
      channel_fee_rate: 0,
      tax_rate: 0,
      revenue_share_rate: 100,
      discount_value: 1,
      refund_amount: 0,
      settlement_amount: 450,
      status: 'pending',
      remark: null,
      created_at: '2026-08-06T00:00:00Z',
      updated_at: '2026-08-06T00:00:00Z',
      items: [
        {
          id: 'line-1',
          reconciliation_id: 'bill-1',
          settlement_cycle: '2026年5月',
          game_name: '魔法启示录',
          revenue: 280,
          discount_rate: 1,
          net_revenue: 280,
          coupon_amount: 0,
          test_fee: 0,
          extra_fee: 0,
          share_ratio: 100,
          tax_rate: 0,
          share_amount: 280,
          settlement_amount: 280,
          sort_order: 0
        },
        {
          id: 'line-2',
          reconciliation_id: 'bill-1',
          settlement_cycle: '2026年6月',
          game_name: '魔法启示录',
          revenue: 170,
          discount_rate: 1,
          net_revenue: 170,
          coupon_amount: 0,
          test_fee: 0,
          extra_fee: 0,
          share_ratio: 100,
          tax_rate: 0,
          share_amount: 170,
          settlement_amount: 170,
          sort_order: 1
        }
      ]
    }

    const record = apiRowToFrontend(apiRow)
    expect(record.settlementNumber).toBe('JS-20260806-001')
    expect(record.settlementAmount).toBe('450.00')
    expect(record.settlementPeriodLabel).toBe('2026年5月—2026年6月')
    expect((record.items as Array<{ settlementCycle: string }>).map((item) => item.settlementCycle)).toEqual([
      '2026年5月',
      '2026年6月'
    ])
  })
})
