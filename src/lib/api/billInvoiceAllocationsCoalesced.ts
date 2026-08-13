import { apiDelete, apiGet, apiPost } from '@/lib/api/client.ts'

export type InvoiceBrief = { id: string; direction: 'input' | 'output'; number: string; counterparty_name: string; gross_amount: number; tax_status: string; issue_date?: string | null }
export type BillInvoiceAllocation = { id: string; bill_type: 'rd' | 'channel'; bill_id: string; invoice_id: string; allocated_gross_amount: number; status: string; match_type: string; match_score: number; match_reasons: string[]; invoice: InvoiceBrief }
export type BillInvoiceCandidate = { invoice: InvoiceBrief; available_amount: number; suggested_amount: number; match_score: number; match_reasons: string[] }
export type BillInvoiceSummary = { bill_type: 'rd' | 'channel'; bill_id: string; bill_amount: number; allocated_amount: number; remaining_amount: number; coverage_percent: number; coverage_status: 'none' | 'partial' | 'complete' | 'over'; allocations: BillInvoiceAllocation[]; candidates: BillInvoiceCandidate[] }
export type BillBrief = { bill_type: 'rd' | 'channel'; bill_id: string; number: string; partner_name: string; game_name?: string | null; settlement_month?: string | null; gross_amount: number; status: string }
export type InvoiceBillAllocation = { id: string; bill_type: 'rd' | 'channel'; bill_id: string; invoice_id: string; allocated_gross_amount: number; status: string; match_type: string; match_score: number; match_reasons: string[]; bill: BillBrief }
export type InvoiceBillCandidate = { bill: BillBrief; available_amount: number; suggested_amount: number; match_score: number; match_reasons: string[] }
export type InvoiceAllocationOverview = { invoice_id: string; invoice_amount: number; allocated_amount: number; remaining_amount: number; coverage_percent: number; coverage_status: 'none' | 'partial' | 'complete' | 'over'; allocation_count: number }
export type InvoiceBillSummary = InvoiceAllocationOverview & { allocations: InvoiceBillAllocation[]; candidates: InvoiceBillCandidate[] }
export type InvoiceAutoMatchItem = { invoice_id: string; invoice_number: string; bill_type: 'rd' | 'channel'; bill_id: string; bill_number: string; allocated_gross_amount: number; match_score: number; match_reasons: string[] }
export type InvoiceAutoMatchResponse = { dry_run: boolean; matched: number; matched_amount: number; ambiguous: number; unmatched: number; skipped: number; items: InvoiceAutoMatchItem[] }

type OverviewRow = Pick<BillInvoiceSummary, 'bill_type' | 'bill_id' | 'bill_amount' | 'allocated_amount' | 'remaining_amount' | 'coverage_percent' | 'coverage_status'> & { key: string }
type Waiter = { resolve: (value: BillInvoiceSummary) => void; reject: (reason?: unknown) => void }
type PendingRead = { billType: 'rd' | 'channel'; billId: string; waiters: Waiter[] }

const PATH = '/api/bill-invoice-allocations'
const SUMMARY_TTL_MS = 15_000
const summaryCache = new Map<string, { value: BillInvoiceSummary; expiresAt: number }>()
const summaryInflight = new Map<string, Promise<BillInvoiceSummary>>()
const pendingReads = new Map<string, PendingRead>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function keyFor(billType: 'rd' | 'channel', billId: string) { return `${billType}:${String(billId || '').trim()}` }

function loadFullSummary(billType: 'rd' | 'channel', billId: string): Promise<BillInvoiceSummary> {
  const key = keyFor(billType, billId)
  const cached = summaryCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
  if (cached) summaryCache.delete(key)
  const running = summaryInflight.get(key)
  if (running) return running
  const request = apiGet<BillInvoiceSummary>(`${PATH}/bill/${encodeURIComponent(billType)}/${encodeURIComponent(billId)}`)
    .then((value) => { summaryCache.set(key, { value, expiresAt: Date.now() + SUMMARY_TTL_MS }); return value })
    .finally(() => { if (summaryInflight.get(key) === request) summaryInflight.delete(key) })
  summaryInflight.set(key, request)
  return request
}

async function resolveFull(pending: PendingRead) {
  try {
    const value = await loadFullSummary(pending.billType, pending.billId)
    pending.waiters.forEach(({ resolve }) => resolve(value))
  } catch (error) {
    pending.waiters.forEach(({ reject }) => reject(error))
  }
}

async function flushPendingReads() {
  flushTimer = null
  const entries = [...pendingReads.entries()]
  pendingReads.clear()
  if (!entries.length) return
  if (entries.length === 1) {
    await resolveFull(entries[0][1])
    return
  }

  try {
    const keys = entries.map(([key, pending]) => ({ key, bill_type: pending.billType, bill_id: pending.billId }))
    const response = await apiPost<{ items: OverviewRow[] }>('/api/reconciliation/bill-invoice-overviews', { keys })
    const overviewMap = new Map((response.items || []).map((item) => [item.key, item]))
    await Promise.all(entries.map(async ([key, pending]) => {
      const overview = overviewMap.get(key)
      if (!overview) return resolveFull(pending)
      const summary: BillInvoiceSummary = { ...overview, allocations: [], candidates: [] }
      pending.waiters.forEach(({ resolve }) => resolve(summary))
    }))
  } catch {
    await Promise.all(entries.map(([, pending]) => resolveFull(pending)))
  }
}

export function clearBillInvoiceSummaryCache(billType?: 'rd' | 'channel', billId?: string) {
  if (!billType || !billId) { summaryCache.clear(); summaryInflight.clear(); return }
  const key = keyFor(billType, billId)
  summaryCache.delete(key); summaryInflight.delete(key)
}

export function getBillInvoiceSummary(billType: 'rd' | 'channel', billId: string): Promise<BillInvoiceSummary> {
  const key = keyFor(billType, billId)
  const cached = summaryCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
  const running = summaryInflight.get(key)
  if (running) return running

  return new Promise((resolve, reject) => {
    const pending = pendingReads.get(key)
    if (pending) pending.waiters.push({ resolve, reject })
    else pendingReads.set(key, { billType, billId: String(billId), waiters: [{ resolve, reject }] })
    if (flushTimer === null) flushTimer = setTimeout(() => { void flushPendingReads() }, 0)
  })
}

export function listInvoiceAllocationOverviews(invoiceIds: string[]): Promise<InvoiceAllocationOverview[]> {
  const ids = [...new Set(invoiceIds.map((id) => String(id).trim()).filter(Boolean))]
  if (!ids.length) return Promise.resolve([])
  const query = new URLSearchParams({ invoice_ids: ids.join(',') })
  return apiGet(`${PATH}/invoices/overview?${query.toString()}`)
}
export function getInvoiceBillSummary(invoiceId: string): Promise<InvoiceBillSummary> { return apiGet(`${PATH}/invoice/${encodeURIComponent(invoiceId)}`) }
export function createBillInvoiceAllocation(payload: { bill_type: 'rd' | 'channel'; bill_id: string; invoice_id: string; allocated_gross_amount: number; match_type?: string; match_score?: number; match_reasons?: string[] }): Promise<BillInvoiceAllocation> {
  return apiPost<BillInvoiceAllocation>(PATH, payload).then((result) => { clearBillInvoiceSummaryCache(payload.bill_type, payload.bill_id); return result })
}
export function reverseBillInvoiceAllocation(id: string): Promise<void> {
  return apiDelete<void>(`${PATH}/${encodeURIComponent(id)}`).then((result) => { clearBillInvoiceSummaryCache(); return result })
}
export function autoMatchInvoices(payload: { invoice_direction?: 'input' | 'output'; invoice_ids?: string[]; threshold?: number; unique_margin?: number; dry_run: boolean }): Promise<InvoiceAutoMatchResponse> {
  return apiPost<InvoiceAutoMatchResponse>(`${PATH}/auto-match`, payload).then((result) => { if (!payload.dry_run) clearBillInvoiceSummaryCache(); return result })
}
