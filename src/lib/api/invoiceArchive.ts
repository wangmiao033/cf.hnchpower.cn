import { apiGet, apiPost } from '@/lib/api/client.ts'

export type InvoiceArchiveItem = {
  invoice_id: string
  archived_at?: string | null
  archive_source?: string | null
  archived_by_email?: string | null
}

export type InvoiceArchiveSnapshot = {
  archived_ids: string[]
  held_ids: string[]
  archived_count: number
  held_count: number
  items: InvoiceArchiveItem[]
  scanned?: number
  auto_archived?: number
  auto_reopened?: number
  held?: number
}

export function getInvoiceArchiveSnapshot(): Promise<InvoiceArchiveSnapshot> {
  return apiGet<InvoiceArchiveSnapshot>('/api/invoices/archive/snapshot')
}

export function syncInvoiceArchiveRecords(): Promise<InvoiceArchiveSnapshot> {
  return apiPost<InvoiceArchiveSnapshot>('/api/invoices/archive/sync', {})
}

export function archiveInvoiceRecord(invoiceId: string): Promise<{ invoice_id: string; archived: boolean }> {
  return apiPost(`/api/invoices/${encodeURIComponent(invoiceId)}/archive`, {})
}

export function unarchiveInvoiceRecord(invoiceId: string): Promise<{ invoice_id: string; archived: boolean }> {
  return apiPost(`/api/invoices/${encodeURIComponent(invoiceId)}/unarchive`, {})
}
