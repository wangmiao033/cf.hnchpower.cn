import { apiGet, apiPost } from '@/lib/api/client.ts'

export type FinanceInvoiceTask = {
  id: string
  task_no: string
  bill_type: 'channel' | 'rd'
  bill_id: string
  direction: 'output' | 'input'
  status: 'pending' | 'processing' | 'completed' | 'rejected' | string
  requested_amount: number
  allocated_amount: number
  bill_number?: string | null
  partner_name?: string | null
  game_name?: string | null
  settlement_month?: string | null
  submitted_by_name?: string | null
  submitted_by_email?: string | null
  submitted_at: string
  assigned_to_name?: string | null
  assigned_to_email?: string | null
  started_at?: string | null
  rejected_at?: string | null
  reject_reason?: string | null
  completed_at?: string | null
  completed_by_name?: string | null
  invoice_id?: string | null
  remark?: string | null
}

export type FinanceTaskSummary = {
  pending_count: number
  pending_amount: number
  processing_count: number
  processing_amount: number
  completed_count: number
  completed_amount: number
  rejected_count: number
  rejected_amount: number
}

export type FinanceTaskBillStatus = {
  bill_type: string
  bill_id: string
  task_id: string
  task_no: string
  status: string
  requested_amount: number
  allocated_amount: number
  assigned_to_name?: string | null
  submitted_at: string
  started_at?: string | null
  completed_at?: string | null
  reject_reason?: string | null
  invoice_id?: string | null
}

const PATH = '/api/finance-tasks'

export function submitChannelInvoiceRequest(billId: string): Promise<FinanceInvoiceTask> {
  return apiPost(`${PATH}/invoice-requests/channel/${encodeURIComponent(billId)}`, {})
}

export function getInvoiceRequestStatuses(billIds: string[]): Promise<{ items: FinanceTaskBillStatus[] }> {
  const ids = [...new Set(billIds.map(String).map((value) => value.trim()).filter(Boolean))]
  if (!ids.length) return Promise.resolve({ items: [] })
  const query = new URLSearchParams({ bill_ids: ids.join(',') })
  return apiGet(`${PATH}/invoice-requests/by-bills?${query.toString()}`)
}

export function listFinanceInvoiceTasks(status = 'all'): Promise<{ items: FinanceInvoiceTask[]; total: number }> {
  const query = new URLSearchParams({ status, limit: '500', offset: '0' })
  return apiGet(`${PATH}/invoice-tasks?${query.toString()}`)
}

export function getFinanceTaskSummary(): Promise<FinanceTaskSummary> {
  return apiGet(`${PATH}/invoice-tasks/summary`)
}

export function startFinanceInvoiceTask(taskId: string): Promise<FinanceInvoiceTask> {
  return apiPost(`${PATH}/invoice-tasks/${encodeURIComponent(taskId)}/start`, {})
}

export function rejectFinanceInvoiceTask(taskId: string, reason: string): Promise<FinanceInvoiceTask> {
  return apiPost(`${PATH}/invoice-tasks/${encodeURIComponent(taskId)}/reject`, { reason })
}

export function completeFinanceInvoiceTask(
  taskId: string,
  input: { invoice_id: string; allocated_amount?: number | null; remark?: string | null }
): Promise<FinanceInvoiceTask> {
  return apiPost(`${PATH}/invoice-tasks/${encodeURIComponent(taskId)}/complete`, input)
}
