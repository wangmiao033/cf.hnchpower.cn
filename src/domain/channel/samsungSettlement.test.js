import { describe, expect, it } from 'vitest'
import { SAMSUNG_LEGAL_NAME, SAMSUNG_STATEMENT_FEE_RULE as CODE, isSamsungIdentity, samsungRuleFields } from './samsungSettlement.js'
import { initialHeaderForm, initialLineItem, applyChannelRulePreset, buildFullChannelRecord, recordToHeaderForm, recordToLineForms, calculateSettlementDetails } from './channelBillingForm.js'
import { linesWithChannelLineContractFees } from './channelLineContractFee.js'
import { applyContractRecommendation } from './channelRuleAuthority.js'
const header = { ...initialHeaderForm, partnerName: SAMSUNG_LEGAL_NAME, channelName: '三星', settlementMonth: '2026-07', ...samsungRuleFields() }
const line = (flow, fee, platform, extra = {}) => ({ ...initialLineItem(), gameName: '合成游戏', settlementCycle: '2026-07', flow: String(flow), gatewayCost: String(fee), shareRate: '50', taxRate: '6', platformSettlementAmount: String(platform), ...samsungRuleFields(), ...extra })

describe('Samsung explicitly saved statement fee', () => {
  it('accepts the confirmed customer short name used by PartnerPicker', () => {
    expect(isSamsungIdentity({ ...header, channelName: '鹏泰博兴' })).toBe(true)
    expect(isSamsungIdentity({ ...header, channelName: '鹏泰博兴', partnerName: '其他公司' })).toBe(false)
  })
  it.each([[72,2.88,34.56],[215,8.6,103.2],[460,18.2,220.9],[532,21.08,255.46]])('keeps full fee and tax-inclusive settlement %s', (flow, fee, expected) => {
    expect(calculateSettlementDetails(line(flow,fee,expected),header)).toMatchObject({ systemSettlementAmount: expected, settlementDifference: 0 })
  })
  it('aggregates merged game rows and survives form save/reopen', () => {
    const saved = buildFullChannelRecord(header, [line(532,21.08,255.46),line(262,8.6,103.2,{voucherCost:'47'})])
    expect(saved.systemSettlementAmount).toBe(358.66)
    expect(saved.gatewayCost).toBe(29.68)
    const reopened = buildFullChannelRecord(recordToHeaderForm(saved),recordToLineForms(saved))
    expect(reopened.systemSettlementAmount).toBe(358.66)
    expect(reopened.items.map(x=>x.gatewayCost)).toEqual([21.08,8.6])
    expect(reopened.items.every(x=>x.settlementRuleCode===CODE)).toBe(true)
  })
  it('does not infer fees from platform amount or hardcode a monthly exemption', () => {
    expect(calculateSettlementDetails(line(460,18.4,220.9),header).systemSettlementAmount).toBe(220.8)
    const row=line(460,18.4,230)
    expect(linesWithChannelLineContractFees([row],header)[0]).toEqual(row)
  })
  it('preserves saved rule, actual fee and share on generic contract refresh', () => {
    const saved={...header,items:[line(532,21.08,255.46)]}
    const result=applyContractRecommendation(saved,{lines:[{line_index:0,auto_apply:true,recommended:{share_rate:30,channel_fee_rate:5,channel_fee_mode:'percent',tax_mode:'share',settlement_rule_code:'five_percent_gateway_share'}}]})
    expect(result.record.items).toEqual(saved.items)
  })
  it('starts a fresh month without carrying its statement fee', () => {
    const result=applyContractRecommendation({...header,items:[line(532,21.08,255.46)]},{lines:[]},{generated:true})
    expect(result.record.items[0].gatewayCost).toBe('')
  })
  it.each(['其他公司','鹏泰博兴','北京鹏泰博兴科技有限公司分公司'])('requires exact legal identity: %s', partnerName=> {
    expect(isSamsungIdentity({...header,partnerName})).toBe(false)
    expect(()=>applyChannelRulePreset({...header,partnerName},CODE)).toThrow()
  })
  it.each(['其他渠道','三星测试',''])('requires exact channel: %s',channelName=>expect(isSamsungIdentity({...header,channelName})).toBe(false))
  it('leaves historical Samsung and every ordinary 5% bill unchanged until explicit opt-in',()=>{
    const old={...header,settlementRuleCode:'five_percent_gateway_share',channelFeeMode:'percent',channelFeeRate:'5',taxMode:'none'}
    const oldLine={...line(532,0,255.46),settlementRuleCode:'',channelFeeMode:'',channelFeeRate:'',taxMode:''}
    expect(calculateSettlementDetails(oldLine,old).systemSettlementAmount).toBe(252.7)
    expect(calculateSettlementDetails(oldLine,{...old,partnerName:'其他公司',channelName:'4197'}).systemSettlementAmount).toBe(252.7)
  })
})
