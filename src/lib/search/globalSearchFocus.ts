const PREFIX = 'duizhang.globalSearchFocus.'

function stash(key: string, value: string | null | undefined) {
  if (typeof window === 'undefined') return
  const normalized = String(value || '').trim()
  if (normalized) sessionStorage.setItem(`${PREFIX}${key}`, normalized)
}

function consume(key: string): string | null {
  if (typeof window === 'undefined') return null
  const storageKey = `${PREFIX}${key}`
  const value = sessionStorage.getItem(storageKey)
  sessionStorage.removeItem(storageKey)
  return value
}

export function stashContractFocus(id: string) {
  stash('contractId', id)
}

export function consumeContractFocus() {
  return consume('contractId')
}

export function stashPartnerFocus(query: string) {
  stash('partnerQuery', query)
}

export function consumePartnerFocus() {
  return consume('partnerQuery')
}

export function stashBankTransactionFocus(id: string) {
  stash('bankTransactionId', id)
}

export function consumeBankTransactionFocus() {
  return consume('bankTransactionId')
}
