export const DEFAULT_RECEIVING_ENTITY_ID = 'xiongdong-guangzhou'
export const DEFAULT_RECEIVING_ACCOUNT_ID = 'icbc-guangzhou-xinghua-7769'

export const RECEIVING_ENTITIES = Object.freeze([
  Object.freeze({
    id: DEFAULT_RECEIVING_ENTITY_ID,
    name: '广州熊动科技有限公司',
    taxId: '91440104MABURP0XXA',
    registeredAddressPhone: '广州市越秀区江月路13号之一301-自编390-16 13168368952',
    accounts: Object.freeze([
      Object.freeze({
        id: DEFAULT_RECEIVING_ACCOUNT_ID,
        bankName: '中国工商银行股份有限公司广州兴华支行',
        shortBankName: '工商银行广州兴华支行',
        accountNumber: '3602841509200157769'
      })
    ])
  })
])

export function findReceivingEntity(entityId = DEFAULT_RECEIVING_ENTITY_ID) {
  return RECEIVING_ENTITIES.find((entity) => entity.id === entityId) || RECEIVING_ENTITIES[0] || null
}

export function findReceivingAccount(entity, accountId = DEFAULT_RECEIVING_ACCOUNT_ID) {
  const accounts = Array.isArray(entity?.accounts) ? entity.accounts : []
  return accounts.find((account) => account.id === accountId) || accounts[0] || null
}

export function receivingAccountOptionLabel(account) {
  if (!account) return ''
  const number = String(account.accountNumber || '').trim()
  const tail = number ? number.slice(-4) : ''
  const bank = String(account.shortBankName || account.bankName || '').trim()
  return tail ? `${bank}｜尾号${tail}` : bank
}

export function receivingAccountStorageValue(entity, account) {
  if (!entity || !account) return ''
  return [entity.name, account.bankName, account.accountNumber]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('｜')
}

export function manualReceivingAccountStorageValue(entity, bankName, accountNumber) {
  return [entity?.name, bankName, accountNumber]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('｜')
}
