import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api/client.ts'

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

export type ContractBillBinding = {
  bill_type: 'rd' | 'channel'
  bill_id: string
  line_id: string
  access_item_id: string
  match_method: 'manual' | 'auto_locked' | string
  note: string
  confirmed_by: string
  confirmed_at: string | null
  created_at: string | null
  updated_at: string | null
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
  invoice_tax_rate?: string | number | null
  settlement_mode: string | null
  settlement_basis: string | null
  payment_terms: string | null
  score: number
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
  match_method?: 'auto' | 'manual' | 'auto_locked' | string
  locked?: boolean
}

export type ContractBillCandidate = {
  contract_id: string
  contract_name: string
  contract_no?: string | null
  access_item_id: string
  product_name: string
  channel_name: string
  partner_name?: string
  authorization_start: string | null
  authorization_end: string | null
  share_rate?: string | number | null
  channel_fee_rate?: string | number | null
  invoice_tax_rate?: string | number | null
  settlement_mode?: string | null
  settlement_basis?: string | null
  payment_terms?: string | null
  score: number
  confidence: 'high' | 'medium' | 'low'
  authorization_status: 'covered' | 'out_of_range' | 'unknown'
  eligible?: boolean
  reasons?: string[]
}

export type ContractStandardSettlementAmount = {
  status: 'pass' | 'fail' | 'manual'
  supported: boolean
  deterministic: boolean
  actual_amount: number | null
  expected_amount: number | null
  difference_amount: number | null
  variance_abs: number | null
  variance_direction: 'equal' | 'under' | 'over' | 'unknown'
  tolerance: number
  formula_code: string
  formula_label: string
  breakdown: Record<string, unknown>
  assumptions: string[]
  message: string
}

export type ContractAmountSummary = {
  status: 'pass' | 'warning' | 'fail'
  total_lines: number
  comparable_lines: number
  deterministic_lines: number
  blocking_difference_lines: number
  comparable_complete: boolean
  deterministic_complete: boolean
  actual_amount: number | null
  expected_amount: number | null
  difference_amount: number | null
  variance_abs: number | null
  variance_direction: 'equal' | 'under' | 'over' | 'unknown'
}

export type ContractBillLineCheck = {
  line_id: string
  game_name: string
  settlement_cycle: string
  status: ContractCheckStatus
  match: ContractBillMatch | null
  binding?: ContractBillBinding | null
  candidates: ContractBillCandidate[]
  checks: ContractBillFieldCheck[]
  contract_amount?: ContractStandardSettlementAmount | null
  message: string
}

export type ContractReconciliationSnapshot = {
  id: string
  bill_type: 'rd' | 'channel'
  bill_id: string
  event_type: string
  overall_status: 'pass' | 'warning' | 'fail' | string
  summary: Record<string, unknown>
  created_by: string
  created_at: string | null
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
    binding_count?: number
    manual_binding_count?: number
    auto_binding_count?: number
    amount_status?: 'pass' | 'warning' | 'fail'
    amount_comparable_lines?: number
    amount_deterministic_lines?: number
    amount_expected?: number | null
    amount_actual?: number | null
    amount_difference?: number | null
  }
  lines: ContractBillLineCheck[]
  bill_checks: ContractBillFieldCheck[]
  amount_summary?: ContractAmountSummary | null
  last_snapshot?: ContractReconciliationSnapshot | null
}

export type ChannelContractRuleRecommendation = {
  version: string
  generated_at: string
  auto_apply: boolean
  matched_lines: number
  total_lines: number
  message: string
  header_recommendation: null | {
    settlement_rule_code: string
    channel_fee_mode: 'none' | 'percent' | 'fixed'
    channel_fee_rate: number
    tax_mode: 'none' | 'share' | 'after_fee'
    validation_tolerance: number
  }
  lines: Array<{
    line_index: number
    game_name: string
    settlement_cycle: string
    auto_apply: boolean
    confidence: 'high' | 'medium' | 'low' | 'none'
    score: number
    ambiguity_margin?: number
    message: string
    match: null | {
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
      invoice_tax_rate: string | number | null
      settlement_mode: string | null
      settlement_basis: string | null
      payment_terms: string | null
      reasons: string[]
    }
    recommended: null | {
      settlement_rule_code: string
      channel_fee_mode: 'none' | 'percent' | 'fixed'
      channel_fee_rate: number
      tax_mode: 'none' | 'share' | 'after_fee'
      tax_rate: number | null
      share_rate: number | null
      validation_tolerance: number
    }
  }>
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
  return apiGet<ContractBillReconciliation>(`${PATH}/reconcile-v3?${query.toString()}`)
}

export function bindBillContractLine(
  billType: 'rd' | 'channel',
  billId: string,
  lineId: string,
  accessItemId: string,
  note = ''
) {
  return apiPut<ContractBillBinding>(
    `${PATH}/bill-links/${encodeURIComponent(billType)}/${encodeURIComponent(billId)}/${encodeURIComponent(lineId)}`,
    { access_item_id: accessItemId, note }
  )
}

export function unbindBillContractLine(
  billType: 'rd' | 'channel',
  billId: string,
  lineId: string
) {
  return apiDelete(
    `${PATH}/bill-links/${encodeURIComponent(billType)}/${encodeURIComponent(billId)}/${encodeURIComponent(lineId)}`
  )
}

export function autoLockBillContractLines(billType: 'rd' | 'channel', billId: string) {
  return apiPost<{ locked_count: number; reconciliation: ContractBillReconciliation }>(
    `${PATH}/bill-links/auto-lock`,
    { bill_type: billType, bill_id: billId }
  )
}

export function createContractReconciliationSnapshot(
  billType: 'rd' | 'channel',
  billId: string,
  eventType = 'confirmed'
) {
  return apiPost<ContractReconciliationSnapshot>(`${PATH}/reconcile-snapshots`, {
    bill_type: billType,
    bill_id: billId,
    event_type: eventType
  })
}

export function listContractReconciliationSnapshots(
  billType: 'rd' | 'channel',
  billId: string,
  limit = 10
) {
  const query = new URLSearchParams({
    bill_type: billType,
    bill_id: billId,
    limit: String(limit)
  })
  return apiGet<{ items: ContractReconciliationSnapshot[]; total: number }>(
    `${PATH}/reconcile-snapshots?${query.toString()}`
  )
}

export function recommendChannelContractRules(payload: {
  partner_name: string
  channel_name?: string
  lines: Array<{ game_name: string; settlement_cycle: string }>
}) {
  return apiPost<ChannelContractRuleRecommendation>(`${PATH}/channel-rule-recommendation`, payload)
}
