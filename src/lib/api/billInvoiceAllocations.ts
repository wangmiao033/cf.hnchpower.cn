import { apiDelete, apiGet, apiPost } from '@/lib/api/client.ts'

export type InvoiceBrief = {
  id: string
  direction: 'input' | 'output'
  number: string
  counterparty_name: string
  gross_amount: number
  tax_status: string
  issue_date?: string | null
}

export type BillInvoiceAllocation = {
  id: string
  bill_type: 'rd' | 'channel'
  bill_id: string
  invoice_id: string
  allocated_gross_amount: number
  status: string
  match_type: string
  match_score: number
  match_reasons: string[]
  invoice: InvoiceBrief
}

export type BillInvoiceCandidate = {
  invoice: InvoiceBrief
  available_amount: number
  suggested_amount: number
  match_score: number
  match_reasons: string[]
}

export type BillInvoiceSummary = {
  bill_type: 'rd' | 'channel'
  bill_id: string
  bill_amount: number
  allocated_amount: number
  remaining_amount: number
  coverage_percent: number
  coverage_status: 'none' | 'partial' | 'complete' | 'over'
  allocations: BillInvoiceAllocation[]
  candidates: BillInvoiceCandidate[]
}

const PATH = '/api/bill-invoice-allocations'

export function getBillInvoiceSummary(
  billType: 'rd' | 'channel',
  billId: string
): Promise<BillInvoiceSummary> {
  return apiGet(`${PATH}/bill/${encodeURIComponent(billType)}/${encodeURIComponent(billId)}`)
}

export function createBillInvoiceAllocation(payload: {
  bill_type: 'rd' | 'channel'
  bill_id: string
  invoice_id: string
  allocated_gross_amount: number
  match_type?: string
  match_score?: number
  match_reasons?: string[]
}): Promise<BillInvoiceAllocation> {
  return apiPost(PATH, payload)
}

export function reverseBillInvoiceAllocation(id: string): Promise<void> {
  return apiDelete(`${PATH}/${encodeURIComponent(id)}`)
}
