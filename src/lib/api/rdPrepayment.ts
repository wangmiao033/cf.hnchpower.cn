import { apiDelete, apiGet, apiPost } from '@/lib/api/client.ts'

export type RdPrepaymentFundingMapItem = {
  id: string
  bank_transaction_id: string
  access_item_id: string
  funded_amount: number
  product_name?: string | null
  contract_name?: string | null
}

export type RdPrepaymentBankContext = Record<string, any>

export type RdPrepaymentBankRecommendation = {
  id: string
  trade_date?: string | null
  transaction_no?: string | null
  payee_name?: string | null
  summary?: string | null
  source_bank?: string | null
  source_file_name?: string | null
  expense_amount: number
  available_amount: number
  suggested_funding_amount: number
  match_score: number
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
}

export type RdPrepaymentPool = {
  access_item_id: string
  contract_id: string
  product_name?: string | null
  contract_name?: string | null
  contract_no?: string | null
  counterparty?: string | null
  partner_name?: string | null
  partner_short_name?: string | null
  prepayment_agreed_amount: number
  actual_funded_amount: number
  deducted_amount: number
  available_balance: number
  funding_gap: number
  invoice_allocated_amount: number
  invoice_gap: number
  funding_shortfall: number
  status: string
  status_label: string
  status_tone: string
  bank_recommendations: RdPrepaymentBankRecommendation[]
}

export type RdPrepaymentWorkbench = {
  stats: {
    pool_count: number
    agreed_amount: number
    funded_amount: number
    deducted_amount: number
    available_amount: number
    funding_gap: number
    invoice_gap: number
    attention_count: number
  }
  items: RdPrepaymentPool[]
  schema_ready: boolean
}

export type RdPrepaymentPoolDetail = {
  pool: RdPrepaymentPool
  fundings: Array<Record<string, any>>
  deductions: Array<Record<string, any>>
}

export type RdPrepaymentBillEvidence = {
  bill_id: string
  statement_no?: string | null
  settlement_month?: string | null
  partner_name?: string | null
  game_name?: string | null
  bill_amount: number
  prepayment_deduction_amount: number
  cash_payable_amount: number
  status: 'zero_settlement' | 'fully_offset' | 'partially_offset' | 'not_used' | 'not_configured'
  status_label: string
  lines: Array<Record<string, any>>
}

const PATH = '/api/rd-prepayments'

export function getRdPrepaymentBankContext(bankTransactionId: string): Promise<RdPrepaymentBankContext> {
  return apiGet(`${PATH}/bank-context/${encodeURIComponent(bankTransactionId)}`)
}

export function getRdPrepaymentFundingMap(bankTransactionIds: string[]): Promise<{ items: RdPrepaymentFundingMapItem[] }> {
  const ids = bankTransactionIds.filter(Boolean).join(',')
  return apiGet(`${PATH}/funding-map?bank_transaction_ids=${encodeURIComponent(ids)}`)
}

export function getRdPrepaymentWorkbench(recommendationLimit = 3): Promise<RdPrepaymentWorkbench> {
  return apiGet(`${PATH}/workbench?recommendation_limit=${encodeURIComponent(String(recommendationLimit))}`)
}

export function getRdPrepaymentPoolDetail(accessItemId: string): Promise<RdPrepaymentPoolDetail> {
  return apiGet(`${PATH}/pools/${encodeURIComponent(accessItemId)}`)
}

export function getRdPrepaymentBillEvidence(billId: string): Promise<RdPrepaymentBillEvidence> {
  return apiGet(`${PATH}/bills/${encodeURIComponent(billId)}/evidence`)
}

export function createRdPrepaymentFunding(payload: {
  bank_transaction_id: string
  access_item_id: string
  funded_amount: number
  note?: string
}): Promise<RdPrepaymentBankContext> {
  return apiPost(`${PATH}/fundings`, payload)
}

export function deleteRdPrepaymentFunding(fundingId: string): Promise<RdPrepaymentBankContext> {
  return apiDelete(`${PATH}/fundings/${encodeURIComponent(fundingId)}`)
}

export function allocateRdPrepaymentInvoice(
  fundingId: string,
  payload: { invoice_id: string; allocated_amount: number }
): Promise<RdPrepaymentBankContext> {
  return apiPost(`${PATH}/fundings/${encodeURIComponent(fundingId)}/invoices`, payload)
}

export function deleteRdPrepaymentInvoiceAllocation(
  fundingId: string,
  allocationId: string
): Promise<RdPrepaymentBankContext> {
  return apiDelete(`${PATH}/fundings/${encodeURIComponent(fundingId)}/invoices/${encodeURIComponent(allocationId)}`)
}
