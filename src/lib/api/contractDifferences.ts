import { apiGet, apiPost } from '@/lib/api/client.ts'

export type ContractDifferenceStatus = 'pending' | 'processing' | 'resolved'
export type ContractDifferenceHandling =
  | 'edit_bill'
  | 'accept_difference'
  | 'adjustment'
  | 'carry_forward'
  | null

export type ContractDifferenceCase = {
  id: string
  bill_type: 'rd' | 'channel'
  bill_id: string
  line_id: string
  access_item_id?: string | null
  contract_id?: string | null
  contract_name: string
  contract_no: string
  statement_no: string
  partner_name: string
  game_name: string
  settlement_cycle: string
  expected_amount: number
  actual_amount: number
  difference_amount: number
  variance_abs: number
  variance_direction: 'under' | 'over' | 'equal' | string
  status: ContractDifferenceStatus
  handling_type: ContractDifferenceHandling
  substatus: string
  reason_type: string
  description: string
  owner: string
  evidence: string[]
  created_by: string
  created_at: string | null
  updated_by: string
  updated_at: string | null
  resolved_at: string | null
}

export type ContractDifferenceEvent = {
  id: string
  case_id: string
  event_type: string
  title: string
  detail: string
  actor: string
  created_at: string | null
  payload?: Record<string, unknown>
}

export type ContractAdjustment = {
  id: string
  adjustment_no: string
  case_id: string
  source_bill_type: 'rd' | 'channel'
  source_bill_id: string
  source_statement_no: string
  partner_name: string
  game_name: string
  settlement_cycle: string
  direction: string
  direction_label: string
  amount: number
  reason: string
  status: 'open' | 'completed' | 'cancelled'
  invoice_id: string
  bank_transaction_id: string
  reconciliation_note: string
  created_at: string | null
  completed_at: string | null
}

export type ContractCarryForward = {
  id: string
  case_id: string
  source_bill_type: 'rd' | 'channel'
  source_bill_id: string
  source_statement_no: string
  partner_name: string
  game_name: string
  source_month: string
  target_month: string
  direction: 'next_period_add' | 'next_period_deduct' | string
  amount: number
  status: 'pending' | 'applied' | 'cancelled'
  target_bill_type: string
  target_bill_id: string
  note: string
  created_at: string | null
  applied_at: string | null
}

export type ContractDifferenceCaseDetail = ContractDifferenceCase & {
  events: ContractDifferenceEvent[]
  adjustments: ContractAdjustment[]
  carry_forwards: ContractCarryForward[]
}

export type ContractDifferenceSummary = {
  pending_count: number
  processing_count: number
  resolved_count: number
  under_total: number
  over_total: number
  net_difference: number
}

export function listContractDifferenceCases(params: {
  billType?: 'rd' | 'channel'
  billId?: string
  status?: ContractDifferenceStatus
  limit?: number
} = {}) {
  const query = new URLSearchParams()
  if (params.billType) query.set('bill_type', params.billType)
  if (params.billId) query.set('bill_id', params.billId)
  if (params.status) query.set('status', params.status)
  query.set('limit', String(params.limit || 200))
  return apiGet<{
    items: ContractDifferenceCase[]
    total: number
    summary: ContractDifferenceSummary
  }>(`/api/contract-terms/difference-cases?${query.toString()}`)
}

export function getContractDifferenceCase(caseId: string) {
  return apiGet<ContractDifferenceCaseDetail>(
    `/api/contract-terms/difference-cases/${encodeURIComponent(caseId)}`
  )
}

export function handleContractDifferenceCase(
  caseId: string,
  payload: {
    action: 'edit_bill' | 'accept_difference' | 'create_adjustment' | 'carry_forward' | 'reopen'
    reason_type?: string
    description?: string
    owner?: string
    evidence?: string[]
    target_month?: string
  }
) {
  return apiPost<ContractDifferenceCase>(
    `/api/contract-terms/difference-cases/${encodeURIComponent(caseId)}/actions`,
    payload
  )
}

export function completeContractAdjustment(
  adjustmentId: string,
  payload: {
    invoice_id?: string
    bank_transaction_id?: string
    reconciliation_note?: string
  }
) {
  return apiPost<ContractAdjustment>(
    `/api/contract-terms/adjustments/${encodeURIComponent(adjustmentId)}/complete`,
    payload
  )
}

export function listContractCarryForwards(params: {
  targetMonth?: string
  partnerName?: string
  gameName?: string
  status?: 'pending' | 'applied' | 'cancelled' | 'all'
  limit?: number
} = {}) {
  const query = new URLSearchParams()
  if (params.targetMonth) query.set('target_month', params.targetMonth)
  if (params.partnerName) query.set('partner_name', params.partnerName)
  if (params.gameName) query.set('game_name', params.gameName)
  query.set('status', params.status || 'pending')
  query.set('limit', String(params.limit || 100))
  return apiGet<{ items: ContractCarryForward[]; total: number }>(
    `/api/contract-terms/carry-forwards?${query.toString()}`
  )
}

export function applyContractCarryForward(
  carryId: string,
  payload: {
    target_bill_type: 'rd' | 'channel'
    target_bill_id: string
    note?: string
  }
) {
  return apiPost<ContractCarryForward>(
    `/api/contract-terms/carry-forwards/${encodeURIComponent(carryId)}/apply`,
    payload
  )
}
