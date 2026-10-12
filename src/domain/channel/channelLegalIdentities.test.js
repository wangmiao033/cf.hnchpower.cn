import { describe, it, expect } from 'vitest'
import {
  buildFullChannelRecord, initialHeaderForm, recordToHeaderForm
} from './channelBillingForm.js'
import {
  apiChannelRowToFrontend, frontendChannelRecordToPayload
} from '@/lib/api/channel.ts'

function line() {
  return {
    settlementCycle: '2026-08', gameName: '测试游戏', flow: '248.20', discountFactor: '1',
    voucherCost: '0', noWorryCost: '0', refundCost: '0', testCost: '0',
    welfareCost: '0', coinCost: '0', shareRate: '30', taxRate: '5',
    gatewayCost: '0', platformSettlementAmount: '70.74', channelFeeMode: '',
    channelFeeRate: '', taxMode: '', settlementRuleCode: '', validationTolerance: ''
  }
}
function header() {
  return { ...initialHeaderForm, channelName: '天宇互动', partnerName: '天宇互动',
    settlementMonth: '2026-08', channelFeeMode: 'fixed', taxMode: 'share' }
}

describe('channel legal parties never alter revenue calculations', () => {
  it('keeps exactly the same settlement amount with legal identity fields', () => {
    const original = buildFullChannelRecord(header(), [line()])
    const newBill = buildFullChannelRecord({
      ...header(), partnerId: 'stable-business-customer',
      expectedPayerEntityId: 'new-legal-payer',
      expectedReceivingEntityId: 'my-collection-company',
      invoiceEntityId: 'separate-invoice-company',
      payerOverrideReason: '第三方代付'
    }, [line()])
    expect(newBill.settlementAmount).toBe(original.settlementAmount)
    expect(newBill.systemSettlementAmount).toBe(original.systemSettlementAmount)
    expect(newBill.partnerId).toBe('stable-business-customer')
    expect(newBill.expectedPayerEntityId).toBe('new-legal-payer')
    expect(newBill.expectedReceivingEntityId).toBe('my-collection-company')
    expect(newBill.invoiceEntityId).toBe('separate-invoice-company')
    expect(newBill.payerOverrideReason).toBe('第三方代付')
  })

  it('retains contractual and cash identities through API payload and historical record', () => {
    const record = buildFullChannelRecord({
      ...header(), partnerId: 'stable-business-customer',
      expectedPayerEntityId: 'new-legal-payer',
      expectedReceivingEntityId: 'my-collection-company',
      invoiceEntityId: 'invoice-party',
      payerOverrideReason: '确认函'
    }, [line()])
    const payload = frontendChannelRecordToPayload(record)
    expect(payload.partner_id).toBe('stable-business-customer')
    expect(payload.expected_payer_entity_id).toBe('new-legal-payer')
    expect(payload.expected_receiving_entity_id).toBe('my-collection-company')
    expect(payload.invoice_entity_id).toBe('invoice-party')
    expect(payload.payer_override_reason).toBe('确认函')

    const legacy = apiChannelRowToFrontend({
      id: 'old-id', partner_name: '天宇互动', partner_id: 'stable-business-customer',
      expected_payer_entity_id: 'new-legal-payer',
      expected_payer_snapshot: '湖南晨宇互娱网络科技有限公司',
      contract_entity_snapshot: '湖南天宇互娱网络科技有限公司',
      expected_receiving_entity_id: 'my-collection-company',
      invoice_entity_id: 'invoice-party', payer_override_reason: '确认函',
      items: []
    })
    const roundTripped = recordToHeaderForm(legacy)
    expect(roundTripped.partnerId).toBe('stable-business-customer')
    expect(roundTripped.expectedPayerEntityId).toBe('new-legal-payer')
    expect(roundTripped.invoiceEntityId).toBe('invoice-party')
    expect(roundTripped.payerOverrideReason).toBe('确认函')
    expect(legacy.contractEntitySnapshot).toBe('湖南天宇互娱网络科技有限公司')
  })
})
