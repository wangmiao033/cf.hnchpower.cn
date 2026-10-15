import { describe, expect, it } from 'vitest'
import {
  getVoucherEntry,
  getVoucherEntryPreview,
  setVoucherEntryAmount,
  setVoucherEntryMode
} from './channelVoucherEntry.js'
import {
  ANJIU_PRE_DISCOUNT_DEDUCTION_RULE,
  XIAN_WEIZHEN_9917_RULE,
  buildLineRecordFromForm,
  calculateSettlementDetails,
  recordToLineForms
} from './channelBillingForm.js'

const rule = {
  settlementRuleCode: 'five_percent_gateway_share',
  channelFeeMode: 'percent',
  channelFeeRate: 5,
  taxMode: 'none'
}
const july = {
  flow: '123858', discountFactor: '0.005',
  voucherCost: '3.24', voucherFaceValue: '648', voucherDirectCost: '0',
  noWorryCost: '0', refundCost: '0', testCost: '0', welfareCost: '0', coinCost: '0',
  shareRate: '30', taxRate: '0', gatewayCost: '0', platformSettlementAmount: '175.57'
}

describe('渠道代金券：单金额 + 口径单选', () => {
  it('把已有的648折算券显示在同一个金额框里，沿用相邻的折扣系数', () => {
    expect(getVoucherEntry(july)).toMatchObject({mode:'discount', amount:'648', isLegacy:false})
    expect(getVoucherEntryPreview(july,rule)).toEqual({label:'实际抵扣 ¥3.24',amount:3.24})
    expect(calculateSettlementDetails(july,rule).systemSettlementAmount).toBe(175.57)
  })

  it('选直扣不改变所填面额，立即换算且不会重复乘折扣', () => {
    const direct=setVoucherEntryMode(july,'direct',rule)
    expect(getVoucherEntry(direct)).toMatchObject({mode:'direct',amount:'648'})
    expect(direct.voucherFaceValue).toBeNull()
    expect(direct.voucherDirectCost).toBe('648')
    expect(getVoucherEntryPreview(direct,rule).amount).toBe(648)
    expect(setVoucherEntryMode(direct,'discount',rule).voucherFaceValue).toBe('648')
  })

  it('在单一金额框里输入并保存，再读取仍保持原始面额和选择的口径', () => {
    const row=setVoucherEntryAmount({...july,voucherFaceValue:null,voucherDirectCost:'3.24'},'0.2')
    expect(getVoucherEntry(row)).toMatchObject({mode:'direct',amount:'0.2'})
    const record=buildLineRecordFromForm(row,rule)
    const restored=recordToLineForms({items:[record]})[0]
    expect(restored.voucherFaceValue).toBeNull()
    expect(restored.voucherDirectCost).toBe('0.2')
    expect(getVoucherEntry(restored)).toMatchObject({mode:'direct',amount:'0.2'})
    expect(getVoucherEntryPreview(restored,rule).amount).toBe(0.2)
  })

  it('之前人工输入的3.24历史券，未选新口径就不发生二次折算', () => {
    const old={...july,voucherFaceValue:null,voucherDirectCost:null,voucherCost:'3.24'}
    expect(getVoucherEntry(old)).toMatchObject({mode:'legacy',isLegacy:true,amount:'3.24'})
    expect(getVoucherEntryPreview(old,rule).label).toContain('历史')
    expect(setVoucherEntryAmount(old,'4.12')).toMatchObject({
      voucherFaceValue:null,voucherDirectCost:null,voucherCost:'4.12'
    })
    expect(calculateSettlementDetails(old,rule).systemSettlementAmount).toBe(175.57)
  })

  it('新增或旧零代金券默认显示折算，录入时开始使用新字段', () => {
    const blank={...july,voucherFaceValue:null,voucherDirectCost:null,voucherCost:''}
    expect(getVoucherEntry(blank).mode).toBe('discount')
    const added=setVoucherEntryAmount(blank,'648')
    expect(added.voucherFaceValue).toBe('648')
    expect(added.voucherDirectCost).toBeNull()
    expect(getVoucherEntryPreview(added,rule).amount).toBe(3.24)
  })

  it('一款游戏同时存在两种券时显示双券编辑，不会静默丢失一类金额', () => {
    const both={...july,voucherFaceValue:'648',voucherDirectCost:'10'}
    expect(getVoucherEntry(both).mode).toBe('both')
    expect(getVoucherEntryPreview(both,rule).amount).toBe(13.24)
    const switchToDirect=setVoucherEntryMode(both,'direct',rule)
    expect(switchToDirect.voucherFaceValue).toBeNull()
    expect(switchToDirect.voucherDirectCost).toBe('10')
    expect(getVoucherEntry(switchToDirect).mode).toBe('direct')
  })

  it('安久历史券转双券时放到折算栏而不是直接扣648', () => {
    const old={...july,voucherFaceValue:null,voucherDirectCost:null,voucherCost:'648'}
    const special={settlementRuleCode:ANJIU_PRE_DISCOUNT_DEDUCTION_RULE}
    const both=setVoucherEntryMode(old,'both',special)
    expect(both.voucherFaceValue).toBe('648')
    expect(both.voucherDirectCost).toBe('0')
    expect(getVoucherEntryPreview(both,special).amount).toBe(3.24)
    expect(getVoucherEntryPreview(old,special).amount).toBeNull()
  })

  it('特殊西安维真券仅记录不扣减，原有合同规则保持不变', () => {
    const special={settlementRuleCode:XIAN_WEIZHEN_9917_RULE}
    expect(getVoucherEntryPreview(july,special).label).toContain('仅记录')
    expect(getVoucherEntryPreview(july,special).amount).toBe(0)
  })

  it('双券切换零值后正确回到单券，直扣金额保持精度', () => {
    const both=setVoucherEntryMode(july,'both',rule)
    expect(getVoucherEntry(both).mode).toBe('discount')
    const updated={...both,voucherDirectCost:'0.2'}
    expect(getVoucherEntry(updated).mode).toBe('both')
    const onlyDirect=setVoucherEntryMode(updated,'direct',rule)
    expect(getVoucherEntry(onlyDirect)).toMatchObject({mode:'direct',amount:'0.2'})
    expect(getVoucherEntryPreview(onlyDirect,rule).amount).toBe(0.2)
  })
})
