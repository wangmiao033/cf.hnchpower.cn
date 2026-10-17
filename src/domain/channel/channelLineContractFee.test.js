import { describe, expect, it } from 'vitest'
import { initialHeaderForm, initialLineItem } from '@/domain/channel/channelBillingForm.js'
import {
  inferLineContractFeeFromPlatform,
  linesWithChannelLineContractFees
} from '@/domain/channel/channelLineContractFee.js'

const anjiuHeader = {
  ...initialHeaderForm,
  partnerName: '广东安久科技有限公司',
  channelName: '游戏fan（安久）',
  settlementRuleCode: 'five_percent_gateway_share',
  channelFeeMode: 'percent',
  channelFeeRate: '5',
  taxMode: 'none'
}

function mixedBillLines() {
  return [
    {
      ...initialLineItem(),
      settlementCycle: '2026-07',
      gameName: '一起来修仙（0.05折）',
      flow: '871379',
      discountFactor: '0.005',
      voucherCost: '5184',
      shareRate: '30',
      taxRate: '0',
      platformSettlementAmount: '1234.33',
      settlementRuleCode: 'five_percent_gateway_share',
      channelFeeMode: 'percent',
      channelFeeRate: '5',
      taxMode: 'none'
    },
    {
      ...initialLineItem(),
      settlementCycle: '2026-07',
      gameName: '云上征途3折大混服',
      flow: '35',
      discountFactor: '0.3',
      voucherCost: '6',
      shareRate: '25',
      taxRate: '0',
      platformSettlementAmount: '2.18'
    }
  ]
}

describe('channelLineContractFee', () => {
  it('infers share_only / 0% fee when platform amount rejects header 5%', () => {
    const [lineA, lineB] = mixedBillLines()
    const inferred = inferLineContractFeeFromPlatform(lineB, anjiuHeader)
    expect(inferred.channelFeeMode).toBe('none')
    expect(inferred.channelFeeMode).toBe('none')
    expect(Number(inferred.channelFeeRate)).toBe(0)
    expect(inferLineContractFeeFromPlatform(lineA, anjiuHeader).channelFeeRate).toBe('5')
  })

  it('QD-20261015-B78B52 mixed lines persist distinct fee rules for save/confirm', () => {
    const stamped = linesWithChannelLineContractFees(mixedBillLines(), anjiuHeader)
    expect(stamped[0].channelFeeMode).toBe('percent')
    expect(Number(stamped[0].channelFeeRate)).toBe(5)
    expect(stamped[1].channelFeeMode).toBe('none')
    expect(Number(stamped[1].channelFeeRate)).toBe(0)
    expect(stamped[1].channelFeeMode).toBe('none')
  })
})
