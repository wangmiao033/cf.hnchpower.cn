const PREFIX = 'duizhang.globalSearchFocus.'
export const GLOBAL_SEARCH_FOCUS_EVENT = 'duizhang-global-search-focus'

function stash(key: string, value: string | null | undefined, kind: string) {
  if (typeof window === 'undefined') return
  const normalized = String(value || '').trim()
  if (!normalized) return
  sessionStorage.setItem(`${PREFIX}${key}`, normalized)
  window.dispatchEvent(
    new CustomEvent(GLOBAL_SEARCH_FOCUS_EVENT, {
      detail: { kind, value: normalized }
    })
  )
}

function consume(key: string): string | null {
  if (typeof window === 'undefined') return null
  const storageKey = `${PREFIX}${key}`
  const value = sessionStorage.getItem(storageKey)
  sessionStorage.removeItem(storageKey)
  return value
}

export function stashContractFocus(id: string) {
  stash('contractId', id, 'contract')
}

export function consumeContractFocus() {
  return consume('contractId')
}

export function stashPartnerFocus(query: string, partnerId = '') {
  if (typeof window !== 'undefined') {
    const id = String(partnerId || '').trim()
    if (id) sessionStorage.setItem(`${PREFIX}partnerId`, id)
    else sessionStorage.removeItem(`${PREFIX}partnerId`)
  }
  stash('partnerQuery', query, 'partner')
}

export function consumePartnerFocus() {
  return consume('partnerQuery')
}

export function consumePartnerFocusId() {
  return consume('partnerId')
}

export function stashBankTransactionFocus(id: string) {
  stash('bankTransactionId', id, 'bank_transaction')
}

export function consumeBankTransactionFocus() {
  return consume('bankTransactionId')
}
