import { describe, expect, it } from 'vitest'
import {
  apiPartnerRowToFrontend,
  frontendPartnerToPayload
} from '@/lib/api/partner.ts'

describe('partner api mapping', () => {
  it('maps an API row to the customer-library model', () => {
    expect(
      apiPartnerRowToFrontend({
        id: 'partner-1',
        name: '示例客户',
        short_name: '示例',
        category: '研发商',
        tag: '重点',
        tax_registration_no: 'TAX-001',
        bank_name: '示例银行',
        bank_account: '62220001',
        invoice_content: '信息服务费',
        recipient: '张三',
        recipient_phone: '13800000000',
        mailing_address: '示例地址',
        created_at: '2026-07-26T00:00:00Z',
        updated_at: '2026-07-26T00:00:00Z'
      })
    ).toMatchObject({
      id: 'partner-1',
      name: '示例客户',
      shortName: '示例',
      tag2: '重点',
      taxRegistrationNo: 'TAX-001',
      bankName: '示例银行',
      bankAccount: '62220001',
      invoiceContent: '信息服务费',
      recipient: '张三',
      recipientPhone: '13800000000',
      mailingAddress: '示例地址'
    })
  })

  it('trims frontend values before sending them to the server', () => {
    expect(
      frontendPartnerToPayload({
        name: ' 示例客户 ',
        shortName: ' 示例 ',
        category: '研发商',
        tag2: ' 重点 ',
        taxRegistrationNo: ' TAX-001 ',
        bankName: ' 示例银行 ',
        bankAccount: ' 62220001 ',
        invoiceContent: ' 信息服务费 ',
        recipient: ' 张三 ',
        recipientPhone: ' 13800000000 ',
        mailingAddress: ' 示例地址 '
      })
    ).toEqual({
      name: '示例客户',
      short_name: '示例',
      category: '研发商',
      tag: '重点',
      tax_registration_no: 'TAX-001',
      bank_name: '示例银行',
      bank_account: '62220001',
      invoice_content: '信息服务费',
      recipient: '张三',
      recipient_phone: '13800000000',
      mailing_address: '示例地址'
    })
  })
})
