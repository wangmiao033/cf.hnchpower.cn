import { apiPost } from '@/lib/api/client.ts'
import { clearBillInvoiceSummaryCache } from '@/lib/api/billInvoiceAllocationsCoalesced.ts'

export type IssuedChannelInvoiceMerge = {
  bill_ids: string[]
  buyer_name: string
  buyer_tax_no: string
  seller_name: string
  seller_tax_no?: string | null
  invoice_type: string
  digital_invoice_no?: string | null
  invoice_code?: string | null
  invoice_no?: string | null
  invoice_date: string
  invoice_amount: number
  tax_amount: number
  amount_with_tax: number
  source_file_proof?: string | null
  existing_invoice_id?: string | null
  remark?: string | null
}

export type ChannelInvoiceMergeResult = {
  invoice_id: string
  invoice_number: string
  allocated_amount: number
  allocated_bills: number
  bill_ids: string[]
  linked_existing?: boolean
}

/** Register an already issued invoice; the backend creates the invoice + all links atomically. */
export async function recordIssuedChannelInvoiceMerge(payload: IssuedChannelInvoiceMerge) {
  const result = await apiPost<ChannelInvoiceMergeResult>('/api/channel-invoice-merge/issue', payload)
  for (const id of result.bill_ids) {
    clearBillInvoiceSummaryCache('channel', id)
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('invoice-archive-sync-requested'))
  }
  return result
}
