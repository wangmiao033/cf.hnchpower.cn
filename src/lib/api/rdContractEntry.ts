import { apiGet, apiPost } from '@/lib/api/client.ts'

export type RdContractEntryLineInput = {
  line_index: number
  line_id?: string
  game_name: string
  settlement_cycle: string
  revenue: number
  discount_rate: number
  coupon_amount: number
  test_fee: number
  extra_fee: number
  share_ratio: number
  tax_rate: number
  settlement_amount: number
}

export type RdContractRuleMatch = {
  contract_id?: string | null
  contract_name: string
  contract_no?: string | null
  access_item_id?: string | null
  product_name: string
  partner_name: string
  authorization_start?: string | null
  authorization_end?: string | null
  share_rate?: number | null
  channel_fee_rate?: number | null
  invoice_tax_rate?: number | null
  testing_fee?: number | null
  settlement_mode?: string | null
  settlement_basis?: string | null
  payment_terms?: string | null
  score: number
  confidence: string
  authorization_status: string
  reasons: string[]
}

export type RdContractRuleRecommended = {
  basis_mode: 'actual_paid' | 'discounted_flow' | 'ambiguous' | string
  settlement_mode: string
  settlement_basis: string
  product_discount_reference: number
  settlement_discount_rate: number
  discount_policy: 'reference_only' | 'participates' | 'manual' | string
  share_ratio: number | null
  channel_fee_rate: number
  tax_rate: number
  test_fee: number
  warnings: string[]
}

export type RdContractAmount = {
  status: string
  deterministic: boolean
  actual_amount?: number | null
  expected_amount?: number | null
  difference_amount?: number | null
  variance_abs?: number | null
  variance_direction?: string
  message?: string
  assumptions?: string[]
}

export type RdContractRuleLine = {
  line_index: number
  game_name: string
  settlement_cycle: string
  auto_apply: boolean
  confidence: string
  score: number
  ambiguity_margin: number
  message: string
  match: RdContractRuleMatch | null
  recommended: RdContractRuleRecommended | null
  contract_amount: RdContractAmount | null
}

export type RdContractRuleRecommendation = {
  version: string
  auto_apply: boolean
  matched_lines: number
  auto_apply_lines: number
  total_lines: number
  header_recommendation?: {
    channel_fee_rate: number | null
    compatible: boolean
    message?: string
  } | null
  lines: RdContractRuleLine[]
  message: string
  generated_at: string
}

export type RdContractEntryAuditLine = Record<string, unknown> & {
  line_index: number
  game_name: string
  settlement_cycle: string
  access_item_id?: string | null
  contract_id?: string | null
  contract_name?: string
  contract_no?: string | null
  binding_allowed?: boolean
  override_reason?: string
}

export type RdContractEntrySnapshot = {
  id?: string
  bill_id?: string
  statement_no?: string
  metadata: RdContractEntryAuditLine[]
  created_by?: string
  created_at?: string | null
}

export function recommendRdContractRules(payload: {
  partner_name: string
  lines: RdContractEntryLineInput[]
}): Promise<RdContractRuleRecommendation> {
  return apiPost('/api/contract-terms/rd-rule-recommendation', payload)
}

export function prepareRdContractEntry(payload: {
  statement_no: string
  metadata: RdContractEntryAuditLine[]
}): Promise<{ ok: boolean; statement_no: string; metadata_count: number }> {
  return apiPost('/api/contract-terms/rd-entry/prepare', payload)
}

export function finalizeRdContractEntry(statementNo: string): Promise<RdContractEntrySnapshot> {
  return apiPost('/api/contract-terms/rd-entry/finalize', { statement_no: statementNo })
}

export function getLatestRdContractEntry(billId: string): Promise<RdContractEntrySnapshot> {
  return apiGet(`/api/contract-terms/rd-entry/latest?bill_id=${encodeURIComponent(billId)}`)
}
