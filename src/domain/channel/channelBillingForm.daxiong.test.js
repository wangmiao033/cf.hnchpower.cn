import { describe, expect, it } from 'vitest'
import {
  DAXIONG_NET_RECEIPT_RULE,
  buildFullChannelRecord,
  calculateSettlementDetails,
  detectChannelRulePreset,
  initialHeaderForm
} from './channelBillingForm.js'

const channelName = '大熊游戏'

function line(overrides = {}) {
  return {
    settlementCycle: '2026-07',
    gameName: '帝国雄师',
    flow: '10000',
    discountFactor: '1',
    voucherCost: '0',
    noWorryCost: '0',
    refundCost: '0',
    testCost: '0',
    welfareCost: '0',
    coinCost: '0',
    shareRate: '30',
    taxRate: '0',
    gatewayCost: '0',
    platformSettlementAmount: '7376',
    ...overrides
  }
}

describe('大熊游戏（daxiong_net_receipt）实收直接结算规则', () => {
  it('识别大熊游戏渠道名称', () => {
    expect(detectChannelRulePreset('大熊游戏')).toBe(DAXIONG_NET_RECEIPT_RULE)
    expect(detectChannelRulePreset('大熊')).toBe(DAXIONG_NET_RECEIPT_RULE)
    expect(detectChannelRulePreset('daxiong')).toBe(DAXIONG_NET_RECEIPT_RULE)
    expect(detectChannelRulePreset('普通渠道')).toBe('')
  })

  it('帝国雄师 2026-07 实收 7376 → system/platform 7376, diff 0', () => {
    const record = buildFullChannelRecord(
      { ...initialHeaderForm, channelName, validationTolerance: '0.05' },
      [line()]
    )

    expect(record.settlementRuleCode).toBe(DAXIONG_NET_RECEIPT_RULE)
    expect(record.channelFeeMode).toBe('none')
    expect(record.taxMode).toBe('none')
    expect(record.items[0].systemSettlementAmount).toBe(7376)
    expect(record.items[0].platformSettlementAmount).toBe(7376)
    expect(record.items[0].settlementDifference).toBe(0)
    expect(record.items[0].validationStatus).toBe('pass')
    expect(record.systemSettlementAmount).toBe(7376)
    expect(record.settlementDifference).toBe(0)
  })

  it('竹B/月卡等实收=0的行仍参与计算但系统结算=0', () => {
    const record = buildFullChannelRecord(
      { ...initialHeaderForm, channelName },
      [line({ gameName: '竹B月卡', flow: '500', platformSettlementAmount: '0' })]
    )

    expect(record.items[0].systemSettlementAmount).toBe(0)
    expect(record.items[0].platformSettlementAmount).toBe(0)
    expect(record.items[0].settlementDifference).toBe(0)
    expect(record.items[0].validationStatus).toBe('pass')
  })

  it('分成比例仅台账记录，不影响系统结算金额', () => {
    const details30 = calculateSettlementDetails(
      line({ shareRate: '30' }),
      { ...initialHeaderForm, channelName }
    )
    const details50 = calculateSettlementDetails(
      line({ shareRate: '50' }),
      { ...initialHeaderForm, channelName }
    )

    expect(details30.systemSettlementAmount).toBe(7376)
    expect(details50.systemSettlementAmount).toBe(7376)
  })

  it('未提供平台结算时状态为 unvalidated', () => {
    const details = calculateSettlementDetails(
      line({ platformSettlementAmount: '' }),
      { ...initialHeaderForm, channelName }
    )

    expect(details.platformSettlementAmount).toBeNull()
    expect(details.settlementDifference).toBeNull()
    expect(details.validationStatus).toBe('unvalidated')
  })

  it('其他渠道仍使用公式计算', () => {
    const details = calculateSettlementDetails(
      line(),
      {
        ...initialHeaderForm,
        channelName: '普通渠道',
        settlementRuleCode: 'share_only',
        channelFeeMode: 'none',
        taxMode: 'none'
      }
    )

    expect(details.systemSettlementAmount).toBe(3000)
    expect(details.validationStatus).toBe('fail')
  })
})
