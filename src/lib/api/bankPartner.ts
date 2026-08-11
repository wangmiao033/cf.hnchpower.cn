import { apiGet, apiPost } from '@/lib/api/client.ts'

export type BankPartnerSuggestion = {
  partner_id: string
  partner_name: string
  partner_short_name: string
  partner_match_method: string
  partner_match_explicit: boolean
  score: number
}

export type BankCounterpartyMatchRow = {
  counterparty_key: string
  counterparty_name: string
  accounts: string[]
  directions: string[]
  transaction_count: number
  income_total: number
  expense_total: number
  total_amount: number
  last_trade_date?: string | null
  matched: boolean
  explicit: boolean
  partner_id?: string | null
  partner_name?: string | null
  partner_short_name?: string | null
  match_method?: string | null
  suggested_partner?: BankPartnerSuggestion | null
}

export type BankCustomerMatchCenter = {
  stats: {
    counterparties: number
    matched: number
    manual: number
    unmatched: number
  }
  items: BankCounterpartyMatchRow[]
}

const PATH = '/api/bank-auto-reconciliation'

export function getBankCustomerMatchCenter() {
  return apiGet<BankCustomerMatchCenter>(`${PATH}/customer-center`)
}

export function linkBankCounterparty(counterpartyName: string, partnerId: string) {
  return apiPost<{
    counterparty_name: string
    partner_id: string
    partner_name: string
    partner_short_name: string
    match_method: string
  }>(`${PATH}/customer-links`, {
    counterparty_name: counterpartyName,
    partner_id: partnerId
  })
}

export function unlinkBankCounterparty(counterpartyName: string) {
  return apiPost<{ ok: boolean; removed: boolean; counterparty_name: string }>(
    `${PATH}/customer-links/unlink`,
    { counterparty_name: counterpartyName }
  )
}
