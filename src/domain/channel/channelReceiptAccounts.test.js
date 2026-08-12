import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RECEIVING_ACCOUNT_ID,
  DEFAULT_RECEIVING_ENTITY_ID,
  findReceivingAccount,
  findReceivingEntity,
  manualReceivingAccountStorageValue,
  receivingAccountOptionLabel,
  receivingAccountStorageValue
} from './channelReceiptAccounts.js'

describe('channel receipt receiving accounts', () => {
  it('uses Guangzhou Xiongdong ICBC account as the default receiving account', () => {
    const entity = findReceivingEntity(DEFAULT_RECEIVING_ENTITY_ID)
    const account = findReceivingAccount(entity, DEFAULT_RECEIVING_ACCOUNT_ID)

    expect(entity.name).toBe('广州熊动科技有限公司')
    expect(entity.taxId).toBe('91440104MABURP0XXA')
    expect(account.bankName).toBe('中国工商银行股份有限公司广州兴华支行')
    expect(account.accountNumber).toBe('3602841509200157769')
    expect(receivingAccountOptionLabel(account)).toBe('工商银行广州兴华支行｜尾号5769')
  })

  it('stores receiving entity and account without contract party labels', () => {
    const entity = findReceivingEntity()
    const account = findReceivingAccount(entity)
    const value = receivingAccountStorageValue(entity, account)

    expect(value).toContain('广州熊动科技有限公司')
    expect(value).toContain('3602841509200157769')
    expect(value).not.toContain('甲方')
    expect(value).not.toContain('乙方')
  })

  it('keeps manual receiving account entry under the selected company entity', () => {
    const entity = findReceivingEntity()
    expect(manualReceivingAccountStorageValue(entity, '测试银行支行', '123456')).toBe(
      '广州熊动科技有限公司｜测试银行支行｜123456'
    )
  })
})
