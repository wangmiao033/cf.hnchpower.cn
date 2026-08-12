import { describe, expect, it } from 'vitest'
import {
  XIAN_WEIZHEN_9917_RULE,
  buildFullChannelRecord,
  calculateSettlementDetails,
  detectChannelRulePreset,
  initialHeaderForm
} from './channelBillingForm.js'

const partnerName = '西安维真视界文化科技股份有限公司'

function line(overrides = {}) {
  return {
    settlementCycle: '2026-01',
    gameName: '云上征途',
    flow: '82.40',
    discountFactor: '1',
    voucherCost: '51.84',
    noWorryCost: '0',
    refundCost: '0',
    testCost: '0.42',
    welfareCost: '73.64',
    coinCost: '0',
    shareRate: '30',
    taxRate: '5',
    gatewayCost: '0',
    platformSettlementAmount: '23.36',
    ...overrides
  }
}

describe('西安维真（9917）专属渠道结算规则', () => {
  it('仅对西安维真匹配专属规则，不改变其他渠道识别', () => {
    expect(detectChannelRulePreset(partnerName)).toBe(XIAN_WEIZHEN_9917_RULE)
    expect(detectChannelRulePreset('西安维真视界')).toBe(XIAN_WEIZHEN_9917_RULE)
    expect(detectChannelRulePreset('普通渠道')).toBe('')
    expect(detectChannelRulePreset('瓦力（小米）')).toBe('xiaomi_percent_fee')
  })

  it('代金券和福利币仅记录，测试费仍在分成前扣减', () => {
    const record = buildFullChannelRecord(
      { ...initialHeaderForm, partnerName, channelName: '西安维真视界', validationTolerance: '0.05' },
      [line()]
    )

    expect(record.settlementRuleCode).toBe(XIAN_WEIZHEN_9917_RULE)
    expect(record.channelFeeMode).toBe('percent')
    expect(record.channelFeeRate).toBe(5)
    expect(record.taxMode).toBe('none')
    expect(record.items[0].billingAmount).toBe(81.98)
    expect(record.items[0].systemSettlementAmount).toBe(23.36)
    expect(record.items[0].settlementDifference).toBe(0)
    expect(record.items[0].validationStatus).toBe('pass')
  })

  it('截图中的 1-3 月 7 行在专属规则下全部通过，总额与发票 379.75 对齐', () => {
    const rows = [
      line(),
      line({ gameName: '一起来修仙', flow: '44.92', voucherCost: '9.72', testCost: '0', welfareCost: '6.10', platformSettlementAmount: '12.80' }),
      line({ gameName: '圣树唤歌', flow: '0.73', voucherCost: '19.44', testCost: '0', welfareCost: '0', platformSettlementAmount: '0.21' }),
      line({ settlementCycle: '2026-02', gameName: '圣树唤歌', flow: '46.21', voucherCost: '16.20', testCost: '0', welfareCost: '0', platformSettlementAmount: '13.17' }),
      line({ settlementCycle: '2026-02', gameName: '一起来修仙', flow: '1.49', voucherCost: '9.72', testCost: '0', welfareCost: '0', platformSettlementAmount: '0.43' }),
      line({ settlementCycle: '2026-02', gameName: '云上征途', flow: '12.96', voucherCost: '6.48', testCost: '0', welfareCost: '0', platformSettlementAmount: '3.69' }),
      line({ settlementCycle: '2026-03', gameName: '圣树唤歌', flow: '1144.19', voucherCost: '35.64', testCost: '0', welfareCost: '0', platformSettlementAmount: '326.09' })
    ]

    const record = buildFullChannelRecord(
      { ...initialHeaderForm, partnerName, channelName: '西安维真视界', validationTolerance: '0.05' },
      rows
    )

    expect(record.items.every((item) => item.validationStatus === 'pass')).toBe(true)
    expect(record.systemSettlementAmount).toBe(379.74)
    expect(record.platformSettlementAmount).toBe(379.75)
    expect(record.settlementDifference).toBe(-0.01)
    expect(record.settlementAmount).toBe(379.75)
    expect(record.validationStatus).toBe('pass')
  })

  it('相同数据在普通渠道旧规则下仍保持原有扣减逻辑', () => {
    const details = calculateSettlementDetails(
      line(),
      {
        ...initialHeaderForm,
        partnerName: '普通渠道公司',
        channelName: '普通渠道',
        settlementRuleCode: 'five_percent_gateway_share',
        channelFeeMode: 'percent',
        channelFeeRate: '5',
        taxMode: 'none'
      }
    )
    expect(details.systemSettlementAmount).toBe(-12.4)
    expect(details.validationStatus).toBe('fail')
  })
})
