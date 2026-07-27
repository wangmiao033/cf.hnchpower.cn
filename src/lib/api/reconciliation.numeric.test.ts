import { describe, expect, it } from 'vitest'
import { frontendRecordToApiPayload } from '@/lib/api/reconciliation.ts'

describe('reconciliation numeric payload mapping', () => {
  it('converts blank amount cells to valid numeric defaults', () => {
    const payload = frontendRecordToApiPayload({
      settlementNumber: 'JS-20260723-005',
      settlementMonth: '2026年6月',
      partner: '广州明朝互动科技股份有限公司',
      gameFlow: '596354',
      testingFee: '',
      voucher: '',
      channelFeeRate: '',
      taxPoint: '',
      revenueShareRatio: '20',
      discount: '',
      refund: '',
      settlementAmount: '837.94',
      items: [
        {
          settlementCycle: '2026年6月',
          gameName: '六界飞仙01折',
          revenue: '291480',
          discountRate: '0.01',
          couponAmount: '',
          testFee: '77.28',
          extraFee: '',
          shareRatio: '20',
          taxRate: ''
        }
      ]
    })

    expect(payload).toMatchObject({
      test_cost: 0,
      voucher_cost: 0,
      channel_fee_rate: 0,
      tax_rate: 0,
      discount_value: 1,
      refund_amount: 0,
      items: [
        {
          coupon_amount: 0,
          test_fee: 77.28,
          extra_fee: 0,
          tax_rate: 0
        }
      ]
    })
    expect(JSON.stringify(payload)).not.toContain('"coupon_amount":null')
  })
})
