import { apiGet, apiPost } from '@/lib/api/client.ts'

export type BankMatchCandidate = {
  bill_type: 'rd' | 'channel'
  bill_id: string
  bill_number: string
  partner_name: string
  settlement_month?: string | null
  game_name?: string | null
  bill_amount: number
  outstanding_amount: number
  score: number
  confidence_level: 'high' | 'medium' | 'low'
  reasons: string[]
}

export type BankMatchSuggestion = {
  transaction_id: string
  trade_date?: string | null
  transaction_no?: string | null
  direction: 'collection' | 'payment' | 'unknown'
  direction_label: string
  amount: number
  currency?: string | null
  counterparty_name?: string | null
  summary?: string | null
  auto_ready: boolean
  confidence_level: 'high' | 'medium' | 'low' | 'none'
  top_score: number
  ambiguity_margin: number
  candidates: BankMatchCandidate[]
  blocked_reason?: string | null
}

export type BankMatchHistoryRow = {
  match_id: string
  bank_transaction_id: string
  trade_date?: string | null
  transaction_no?: string | null
  direction: string
  direction_label: string
  bill_type: 'rd' | 'channel'
  bill_id: string
  bill_number?: string | null
  linked_amount: number
  confidence_score: number
  confidence_level: string
  status: 'confirmed' | 'reversed'
  confirmed_email?: string | null
  confirmed_at: string
  reversed_email?: string | null
  reversed_at?: string | null
  reverse_reason?: string | null
}

export type BankAutoReconciliationDashboard = {
  stats: {
    pending_transactions: number
    high_confidence: number
    medium_confidence: number
    unmatched: number
    confirmed_matches: number
    confirmed_amount: number
  }
  suggestions: BankMatchSuggestion[]
  recent_matches: BankMatchHistoryRow[]
}

const PATH = '/api/bank-auto-reconciliation'

export function getBankAutoReconciliationDashboard(limit = 200) {
  return apiGet<BankAutoReconciliationDashboard>(`${PATH}?limit=${limit}`)
}

export function confirmBankAutoReconciliation(
  transactionId: string,
  billType: 'rd' | 'channel',
  billId: string
) {
  return apiPost<{ match: BankMatchHistoryRow; message: string }>(
    `${PATH}/${encodeURIComponent(transactionId)}/confirm`,
    { bill_type: billType, bill_id: billId }
  )
}

export function reverseBankAutoReconciliation(matchId: string, reason: string) {
  return apiPost<{ match: BankMatchHistoryRow; message: string }>(
    `${PATH}/matches/${encodeURIComponent(matchId)}/reverse`,
    { reason }
  )
}
