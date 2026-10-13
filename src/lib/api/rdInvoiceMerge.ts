import { apiPost } from '@/lib/api/client.ts'
import { clearBillInvoiceSummaryCache } from '@/lib/api/billInvoiceAllocationsCoalesced.ts'

export type RdInputInvoiceMergePayload = {
  bill_ids: string[]
  buyer_name: string
  buyer_tax_no: string
  seller_name: string
  seller_tax_no: string
  invoice_type: string
  digital_invoice_no?: string | null
  invoice_code?: string | null
  invoice_no?: string | null
  invoice_date: string
  invoice_amount: number
  tax_amount: number
  amount_with_tax: number
  remark?: string | null
}

export type RdInputInvoiceMergeResult = {
  invoice_id: string
  invoice_number: string
  allocated_amount: number
  allocated_bills: number
  bill_ids: string[]
}

/** Register one already received, real input invoice and allocate it to R&D bills. */
export async function registerRdInputInvoiceMerge(payload: RdInputInvoiceMergePayload) {
  const result = await apiPost<RdInputInvoiceMergeResult>('/api/rd-invoice-merge/receive', payload)
  for (const billId of result.bill_ids) clearBillInvoiceSummaryCache('rd', billId)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('invoice-archive-sync-requested'))
  }
  return result
}
