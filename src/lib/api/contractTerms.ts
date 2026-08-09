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
