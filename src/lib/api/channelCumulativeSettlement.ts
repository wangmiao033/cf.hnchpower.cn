import { apiGet, apiPost, apiPut } from '@/lib/api/client.ts'

export type ChannelCumulativePolicy = {
  id: string | null
  partner_key: string
  partner_name: string
  settlement_mode: 'periodic' | 'threshold'
  threshold_basis: 'billing_flow' | 'settlement_amount'
  threshold_amount: number
  scope: 'partner'
  enabled: boolean
  note: string
  created_at?: string | null
  updated_at?: string | null
}

export type ChannelCumulativePoolBill = {
  bill_id: string
  bill_number: string
  settlement_month: string
  game_name: string
  basis_amount: number
  settlement_amount: number
}

export type ChannelCumulativePool = {
  policy: ChannelCumulativePolicy
  state: 'periodic' | 'accumulating' | 'ready'
  ready: boolean
  deferred: boolean
  basis_total: number
  settlement_total: number
  remaining_to_threshold: number
  progress_percent: number
  bill_count: number
  period_start: string | null
  period_end: string | null
  bills: ChannelCumulativePoolBill[]
}

export type ChannelCumulativeBatchItem = {
  id: string
  bill_id: string
  bill_number: string
  settlement_month: string | null
  game_name: string
  basis_amount: number
  settlement_amount: number
  received_amount: number
}

export type ChannelCumulativeBatch = {
  id: string
  batch_no: string
  partner_key: string
  partner_name: string
  threshold_basis: 'billing_flow' | 'settlement_amount'
  threshold_amount: number
  basis_total: number
  settlement_total: number
  period_start: string | null
  period_end: string | null
  status: 'ready' | 'invoicing' | 'invoiced' | 'settled' | 'cancelled' | string
  invoice_task_id: string | null
  invoice_id: string | null
  received_total: number
  remaining_receivable: number
  created_by_id: string | null
  created_by_name: string | null
  created_at: string | null
  invoiced_at: string | null
  settled_at: string | null
  cancelled_at?: string | null
  cancel_reason?: string
  items: ChannelCumulativeBatchItem[]
}

export type ChannelCumulativeBillCondition = {
  mode: 'periodic' | 'threshold'
  state: 'normal' | 'not_applicable' | 'financial_activity_started' | 'accumulating' | 'ready' | 'batched' | string
  deferred: boolean
  policy: ChannelCumulativePolicy
  pool: ChannelCumulativePool | null
  batch: ChannelCumulativeBatch | null
}

const PATH = '/api/channel-cumulative-settlement'

export function getChannelCumulativePolicy(partnerName: string) {
  const query = new URLSearchParams({ partner_name: partnerName })
  return apiGet<ChannelCumulativePolicy>(`${PATH}/policy?${query.toString()}`)
}

export function saveChannelCumulativePolicy(payload: Partial<ChannelCumulativePolicy> & { partner_name: string }) {
  return apiPut<ChannelCumulativePolicy>(`${PATH}/policy`, payload)
}

export function getChannelCumulativePool(partnerName: string) {
  const query = new URLSearchParams({ partner_name: partnerName })
  return apiGet<ChannelCumulativePool>(`${PATH}/pool?${query.toString()}`)
}

export function getChannelCumulativeBillCondition(billId: string) {
  return apiGet<ChannelCumulativeBillCondition>(`${PATH}/bill/${encodeURIComponent(billId)}`)
}

export function getChannelCumulativeBillStatuses(billIds: string[]) {
  const query = new URLSearchParams({ bill_ids: billIds.join(',') })
  return apiGet<{ items: Array<ChannelCumulativeBillCondition & { bill_id: string }>; total: number }>(
    `${PATH}/bill-statuses?${query.toString()}`
  )
}

export function createChannelCumulativeBatch(partnerName: string) {
  return apiPost<ChannelCumulativeBatch>(`${PATH}/batches`, { partner_name: partnerName })
}

export function listChannelCumulativeBatches(partnerName: string, limit = 20) {
  const query = new URLSearchParams({ partner_name: partnerName, limit: String(limit) })
  return apiGet<{ items: ChannelCumulativeBatch[]; total: number }>(`${PATH}/batches?${query.toString()}`)
}

export function cancelChannelCumulativeBatch(batchId: string, reason: string) {
  return apiPost<ChannelCumulativeBatch>(`${PATH}/batches/${encodeURIComponent(batchId)}/cancel`, { reason })
}

export function submitChannelCumulativeBatchInvoice(batchId: string) {
  return apiPost<{ task_id: string; task_no: string; status: string; batch: ChannelCumulativeBatch }>(
    `${PATH}/batches/${encodeURIComponent(batchId)}/submit-invoice`,
    {}
  )
}
