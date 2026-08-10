import { apiDelete, apiGet, apiPut } from '@/lib/api/client.ts'

export type ContractAccessTerms = {
  access_item_id: string
  contract_id: string
  settlement_mode: string
  settlement_basis: string
  unit_price: string | null
  currency: string
  settlement_cycle: string
  payment_terms: string
  invoice_tax_rate: string | null
  invoice_type: string
  refund_rule: string
  testing_fee: string | null
  server_cost_bearer: string
  prepayment_amount: string | null
  minimum_guarantee_amount: string | null
  deduction_rule: string
  created_at: string
  updated_at: string
}

export type ContractAccessTermsPayload = {
  contract_id?: string
  settlement_mode?: string
  settlement_basis?: string
  unit_price?: string | number | null
  currency?: string
  settlement_cycle?: string
  payment_terms?: string
  invoice_tax_rate?: string | number | null
  invoice_type?: string
  refund_rule?: string
  testing_fee?: string | number | null
  server_cost_bearer?: string
  prepayment_amount?: string | number | null
  minimum_guarantee_amount?: string | number | null
  deduction_rule?: string
}

export type ContractCheckStatus = 'pass' | 'warning' | 'fail' | 'unmatched'
export type ContractFieldCheckStatus = 'pass' | 'fail' | 'manual' | 'missing' | 'not_applicable'

export type ContractBillFieldCheck = {
  key: string
  label: string
  status: ContractFieldCheckStatus
  bill_value: unknown
  contract_value: unknown
  difference: number | null
  message: string
}

export type ContractBillMatch = {
  contract_id: string
  contract_name: string
  contract_no: string | null
  access_item_id: string
  product_name: string
  channel_name: string
  authorization_start: string | null
  authorization_end: string | null
  share_rate: string | number | null
  channel_fee_rate: string | number | null
  settlement_mode: string | null
  settlement_basis: string | null
  payment_terms: string | null
  score: number
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
}

export type ContractBillLineCheck = {
  line_id: string
  game_name: string
  settlement_cycle: string
  status: ContractCheckStatus
  match: ContractBillMatch | null
  candidates: Array<{
    contract_id: string
    contract_name: string
    access_item_id: string
    product_name: string
    channel_name: string
    score: number
    confidence: 'high' | 'medium' | 'low'
    authorization_status: 'covered' | 'out_of_range' | 'unknown'
  }>
  checks: ContractBillFieldCheck[]
  message: string
}

export type ContractBillReconciliation = {
  version: string
  generated_at: string
  bill: {
    bill_type: 'rd' | 'channel'
    bill_id: string
    statement_no: string
    settlement_month: string
    partner_name: string
    channel_name: string
    channel_fee_rate: number | null
    server_cost: number
    unallocated_refund_amount: number
    remark: string
  }
  summary: {
    total_lines: number
    matched_lines: number
    pass_count: number
    warning_count: number
    fail_count: number
    unmatched_count: number
    issue_count: number
    overall_status: 'pass' | 'warning' | 'fail'
    can_auto_confirm: boolean
  }
  lines: ContractBillLineCheck[]
  bill_checks: ContractBillFieldCheck[]
}

const PATH = '/api/contract-terms'

export function listContractAccessTerms(params?: { contractId?: string; accessItemId?: string }) {
  const query = new URLSearchParams()
  if (params?.contractId) query.set('contract_id', params.contractId)
  if (params?.accessItemId) query.set('access_item_id', params.accessItemId)
  const qs = query.toString()
  return apiGet<{ items: ContractAccessTerms[]; total: number }>(`${PATH}${qs ? `?${qs}` : ''}`)
}

export function upsertContractAccessTerms(accessItemId: string, payload: ContractAccessTermsPayload) {
  return apiPut<ContractAccessTerms>(`${PATH}/${encodeURIComponent(accessItemId)}`, payload)
}

export function deleteContractAccessTerms(accessItemId: string) {
  return apiDelete(`${PATH}/${encodeURIComponent(accessItemId)}`)
}

export function getContractBillReconciliation(billType: 'rd' | 'channel', billId: string) {
  const query = new URLSearchParams({ bill_type: billType, bill_id: billId })
  return apiGet<ContractBillReconciliation>(`${PATH}/reconcile?${query.toString()}`)
}
