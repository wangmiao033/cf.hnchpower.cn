import { apiGet, apiPost } from '@/lib/api/client.ts'

export type FinanceInvoiceTask = {
  id: string; task_no: string; bill_type: 'channel' | 'rd'; bill_id: string; direction: 'output' | 'input';
  status: 'pending' | 'processing' | 'completed' | 'rejected' | string; requested_amount: number; allocated_amount: number;
  bill_number?: string | null; partner_name?: string | null; game_name?: string | null; settlement_month?: string | null;
  submitted_by_name?: string | null; submitted_by_email?: string | null; submitted_at: string;
  assigned_to_name?: string | null; assigned_to_email?: string | null; started_at?: string | null;
  rejected_at?: string | null; reject_reason?: string | null; completed_at?: string | null;
  completed_by_name?: string | null; invoice_id?: string | null; remark?: string | null
}
export type FinanceTaskSummary = { pending_count: number; pending_amount: number; processing_count: number; processing_amount: number; completed_count: number; completed_amount: number; rejected_count: number; rejected_amount: number }
export type FinanceTaskBillStatus = { bill_type: string; bill_id: string; task_id: string; task_no: string; status: string; requested_amount: number; allocated_amount: number; assigned_to_name?: string | null; submitted_at: string; started_at?: string | null; completed_at?: string | null; reject_reason?: string | null; invoice_id?: string | null }

const PATH = '/api/finance-tasks'
const TTL_MS = 5_000
const statusCache = new Map<string, { value: { items: FinanceTaskBillStatus[] }; expiresAt: number }>()
const statusInflight = new Map<string, Promise<{ items: FinanceTaskBillStatus[] }>>()
let summaryCache: { value: FinanceTaskSummary; expiresAt: number } | null = null
let summaryInflight: Promise<FinanceTaskSummary> | null = null

export function clearFinanceTaskReadCache() {
  statusCache.clear(); statusInflight.clear(); summaryCache = null; summaryInflight = null
}

function afterMutation<T>(request: Promise<T>): Promise<T> {
  return request.then((result) => { clearFinanceTaskReadCache(); return result })
}

export function submitChannelInvoiceRequest(billId: string): Promise<FinanceInvoiceTask> {
  return afterMutation(apiPost(`${PATH}/invoice-requests/channel/${encodeURIComponent(billId)}`, {}))
}

export function getInvoiceRequestStatuses(billIds: string[]): Promise<{ items: FinanceTaskBillStatus[] }> {
  const ids = [...new Set(billIds.map(String).map((value) => value.trim()).filter(Boolean))].sort()
  if (!ids.length) return Promise.resolve({ items: [] })
  const signature = ids.join('|')
  const cached = statusCache.get(signature)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
  if (cached) statusCache.delete(signature)
  const running = statusInflight.get(signature)
  if (running) return running
  const query = new URLSearchParams({ bill_ids: ids.join(',') })
  const request = apiGet<{ items: FinanceTaskBillStatus[] }>(`${PATH}/invoice-requests/by-bills?${query.toString()}`)
    .then((value) => { statusCache.set(signature, { value, expiresAt: Date.now() + TTL_MS }); return value })
    .finally(() => { if (statusInflight.get(signature) === request) statusInflight.delete(signature) })
  statusInflight.set(signature, request)
  return request
}

export function listFinanceInvoiceTasks(status = 'all'): Promise<{ items: FinanceInvoiceTask[]; total: number }> {
  const query = new URLSearchParams({ status, limit: '500', offset: '0' })
  return apiGet(`${PATH}/invoice-tasks?${query.toString()}`)
}

export function getFinanceTaskSummary(): Promise<FinanceTaskSummary> {
  if (summaryCache && summaryCache.expiresAt > Date.now()) return Promise.resolve(summaryCache.value)
  if (summaryInflight) return summaryInflight
  const request = apiGet<FinanceTaskSummary>(`${PATH}/invoice-tasks/summary`)
    .then((value) => { summaryCache = { value, expiresAt: Date.now() + TTL_MS }; return value })
    .finally(() => { if (summaryInflight === request) summaryInflight = null })
  summaryInflight = request
  return request
}

export function startFinanceInvoiceTask(taskId: string): Promise<FinanceInvoiceTask> {
  return afterMutation(apiPost(`${PATH}/invoice-tasks/${encodeURIComponent(taskId)}/start`, {}))
}
export function rejectFinanceInvoiceTask(taskId: string, reason: string): Promise<FinanceInvoiceTask> {
  return afterMutation(apiPost(`${PATH}/invoice-tasks/${encodeURIComponent(taskId)}/reject`, { reason }))
}
export function completeFinanceInvoiceTask(taskId: string, input: { invoice_id: string; allocated_amount?: number | null; remark?: string | null }): Promise<FinanceInvoiceTask> {
  return afterMutation(apiPost(`${PATH}/invoice-tasks/${encodeURIComponent(taskId)}/complete`, input))
}
