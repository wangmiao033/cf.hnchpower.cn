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
  recommended_amount?: number
  score: number
  confidence_level: 'high' | 'medium' | 'low'
  reasons: string[]
}

export type ExistingBankAllocation = {
  match_id: string
  bill_type: 'rd' | 'channel'
  bill_id: string
  bill_number?: string | null
  linked_amount: number
}

export type BankMatchSuggestion = {
  transaction_id: string
  trade_date?: string | null
  transaction_no?: string | null
  direction: 'collection' | 'payment' | 'unknown'
  direction_label: string
  amount: number
  total_amount?: number
  allocated_amount?: number
  remaining_amount?: number
  allocation_count?: number
  allocation_status?: string
  bill_numbers?: string[]
  existing_allocations?: ExistingBankAllocation[]
  currency?: string | null
  counterparty_name?: string | null
  summary?: string | null
  auto_ready?: boolean
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

export type BankTransactionAllocationSummary = {
  transaction_id: string
  direction: string
  total_amount: number
  allocated_amount: number
  remaining_amount: number
  allocation_count: number
  allocation_status: 'unallocated' | 'partial' | 'allocated' | 'blocked'
  bill_numbers: string[]
}

export type BankBillAllocationRow = {
  match_id: string
  bank_transaction_id: string
  linked_amount: number
  trade_date?: string | null
  transaction_no?: string | null
  counterparty_name?: string | null
  summary?: string | null
  bank_account?: string | null
  source_bank?: string | null
  source_file_name?: string | null
  source_row_no?: number | null
  confirmed_email?: string | null
  confirmed_at: string
}

export type BankBillAllocationSummary = {
  bill_type: 'rd' | 'channel'
  bill_id: string
  bill_number: string
  partner_name: string
  bill_amount: number
  bank_allocated_amount: number
  cash_total_amount: number
  remaining_amount: number
  allocation_count: number
  allocations: BankBillAllocationRow[]
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

export type BankMultiAllocationDashboard = {
  stats: {
    pending_transactions: number
    partial_transactions: number
    remaining_amount: number
  }
  suggestions: BankMatchSuggestion[]
}

const PATH = '/api/bank-auto-reconciliation'
const DASHBOARD_TTL_MS = 2_000
const dashboardCache = new Map<string, { value: unknown; expiresAt: number }>()
const dashboardInflight = new Map<string, Promise<unknown>>()

function loadDashboard<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const cached = dashboardCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value as T)
  if (cached) dashboardCache.delete(key)
  const running = dashboardInflight.get(key)
  if (running) return running as Promise<T>
  const request = loader()
    .then((value) => {
      dashboardCache.set(key, { value, expiresAt: Date.now() + DASHBOARD_TTL_MS })
      return value
    })
    .finally(() => {
      if (dashboardInflight.get(key) === request) dashboardInflight.delete(key)
    })
  dashboardInflight.set(key, request)
  return request
}

export function clearBankDashboardCache() {
  dashboardCache.clear()
  dashboardInflight.clear()
}

function afterBankMutation<T>(request: Promise<T>): Promise<T> {
  return request.then((result) => {
    clearBankDashboardCache()
    return result
  })
}

export type BankDashboardFilters = {
  q?: string
  date_from?: string
  date_to?: string
}

export function getBankAutoReconciliationDashboard(limit = 200, filters: BankDashboardFilters = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (filters.q) params.set('q', filters.q)
  if (filters.date_from) params.set('date_from', filters.date_from)
  if (filters.date_to) params.set('date_to', filters.date_to)
  const query = params.toString()
  return loadDashboard(
    `dashboard:${query}`,
    () => apiGet<BankAutoReconciliationDashboard>(`${PATH}?${query}`)
  )
}

export function getBankMultiAllocationDashboard(limit = 500) {
  return loadDashboard(
    `p2:${limit}`,
    () => apiGet<BankMultiAllocationDashboard>(`${PATH}/p2-dashboard?limit=${limit}`)
  )
}

export function confirmBankAutoReconciliation(
  transactionId: string,
  billType: 'rd' | 'channel',
  billId: string
) {
  return afterBankMutation(apiPost<{ match: BankMatchHistoryRow; message: string }>(
    `${PATH}/${encodeURIComponent(transactionId)}/confirm`,
    { bill_type: billType, bill_id: billId }
  ))
}

export function allocateBankTransaction(
  transactionId: string,
  allocations: Array<{ bill_type: 'rd' | 'channel'; bill_id: string; amount: number }>
) {
  return afterBankMutation(apiPost<{
    matches: BankMatchHistoryRow[]
    transaction: BankTransactionAllocationSummary
    message: string
  }>(`${PATH}/${encodeURIComponent(transactionId)}/p2-allocate`, { allocations }))
}

export function getBankTransactionAllocationSummaries(transactionIds: string[]) {
  return apiPost<{ items: BankTransactionAllocationSummary[] }>(`${PATH}/p2/transaction-summaries`, {
    transaction_ids: transactionIds
  })
}

export function getBankBillAllocationSummary(billType: 'rd' | 'channel', billId: string) {
  return apiGet<BankBillAllocationSummary>(
    `${PATH}/p2/bills/${encodeURIComponent(billType)}/${encodeURIComponent(billId)}`
  )
}

export function reverseBankAutoReconciliation(matchId: string, reason: string) {
  return afterBankMutation(apiPost<{ match: BankMatchHistoryRow; message: string }>(
    `${PATH}/matches/${encodeURIComponent(matchId)}/reverse`,
    { reason }
  ))
}
