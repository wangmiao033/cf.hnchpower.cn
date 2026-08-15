/** 发票管理 REST API */

import { apiDelete, apiGet, apiPost, apiPostMultipart, apiPut } from '@/lib/api/client.ts'

export type ApiInvoiceRow = {
  id: string
  invoice_direction: 'output' | 'input' | null
  invoice_type: string | null
  digital_invoice_no: string | null
  invoice_code: string | null
  invoice_no: string | null
  invoice_identity_key: string | null
  buyer_name: string | null
  buyer_tax_no: string | null
  seller_name: string | null
  seller_tax_no: string | null
  title: string | null
  tax_no: string | null
  invoice_amount: number
  tax_amount: number
  amount_with_tax: number
  tax_rate: number | null
  invoice_date: string | null
  issuer: string | null
  invoice_source: string | null
  source_file_name: string | null
  source_file_url: string | null
  source_file_type: string | null
  source_file_size: number | null
  tax_status: string
  original_invoice_id: string | null
  status: string | null
  remark: string | null
  verified: boolean
  verified_amount: number
  verified_record_ids: string[]
  created_at: string
  updated_at: string
}

export type InvoiceListResponse = { items: ApiInvoiceRow[]; total: number }

export type InvoiceRecordPayload = {
  invoice_direction?: 'output' | 'input' | null
  invoice_type?: string | null
  digital_invoice_no?: string | null
  invoice_code?: string | null
  invoice_no?: string | null
  invoice_identity_key?: string | null
  buyer_name?: string | null
  buyer_tax_no?: string | null
  seller_name?: string | null
  seller_tax_no?: string | null
  title?: string | null
  tax_no?: string | null
  invoice_amount: number
  tax_amount?: number
  amount_with_tax?: number
  tax_rate?: number | null
  invoice_date?: string | null
  issuer?: string | null
  invoice_source?: string | null
  source_file_name?: string | null
  source_file_url?: string | null
  source_file_type?: string | null
  source_file_size?: number | null
  tax_status?: string | null
  original_invoice_id?: string | null
  status?: string | null
  remark?: string | null
  verified: boolean
  verified_amount: number
  verified_record_ids: string[]
}

export type InvoiceRecordUpdatePayload = Partial<InvoiceRecordPayload>
export type InvoiceImportResponse = { created: number; updated: number; skipped: number; total: number }

export type ElectronicInvoiceParsedFields = {
  invoice_direction: 'output' | 'input'
  invoice_type: string | null
  digital_invoice_no: string | null
  invoice_code: string | null
  invoice_no: string | null
  buyer_name: string | null
  buyer_tax_no: string | null
  seller_name: string | null
  seller_tax_no: string | null
  invoice_amount: number
  tax_amount: number
  amount_with_tax: number
  tax_rate: number | null
  invoice_date: string | null
  issuer: string | null
  invoice_source: string | null
  tax_status: string
  status: string | null
  source_file_name: string | null
  source_file_url: string | null
  source_file_type: string | null
  source_file_size: number | null
}

export type ElectronicInvoiceParseResponse = {
  parser: 'pdf_text' | 'ofd_xml' | 'xml' | string
  confidence: number
  warnings: string[]
  existing_invoice_id?: string | null
  invoice: ElectronicInvoiceParsedFields
}

const PATH = '/api/invoices'
const INVOICE_ARCHIVE_SYNC_EVENT = 'invoice-archive-sync-requested'

function notifyInvoiceArchiveSync() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(INVOICE_ARCHIVE_SYNC_EVENT))
}

export function listInvoiceRecords(params?: { search?: string; status?: string; limit?: number; offset?: number }): Promise<InvoiceListResponse> {
  const q = new URLSearchParams()
  if (params?.search) q.set('search', params.search)
  if (params?.status) q.set('status', params.status)
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString()
  return apiGet<InvoiceListResponse>(`${PATH}${qs ? `?${qs}` : ''}`)
}

export function getInvoiceRecord(id: string): Promise<ApiInvoiceRow> {
  return apiGet<ApiInvoiceRow>(`${PATH}/${encodeURIComponent(id)}`)
}

export function createInvoiceRecord(payload: InvoiceRecordPayload): Promise<ApiInvoiceRow> {
  return apiPost<ApiInvoiceRow>(PATH, payload).then((result) => {
    notifyInvoiceArchiveSync()
    return result
  })
}

export function importInvoiceRecords(items: InvoiceRecordPayload[], sourceFile?: string): Promise<InvoiceImportResponse> {
  return apiPost<InvoiceImportResponse>(`${PATH}/import`, { items, source_file: sourceFile || null }).then((result) => {
    notifyInvoiceArchiveSync()
    return result
  })
}

export function updateInvoiceRecord(id: string, payload: InvoiceRecordUpdatePayload): Promise<ApiInvoiceRow> {
  return apiPut<ApiInvoiceRow>(`${PATH}/${encodeURIComponent(id)}`, payload).then((result) => {
    notifyInvoiceArchiveSync()
    return result
  })
}

export function deleteInvoiceRecord(id: string): Promise<void> {
  return apiDelete<void>(`${PATH}/${encodeURIComponent(id)}`).then((result) => {
    notifyInvoiceArchiveSync()
    return result
  })
}

export function parseElectronicInvoiceFile(
  file: File,
  direction: 'output' | 'input' = 'output'
): Promise<ElectronicInvoiceParseResponse> {
  const form = new FormData()
  form.append('file', file)
  return apiPostMultipart<ElectronicInvoiceParseResponse>(
    `/api/electronic-invoices/parse?direction=${encodeURIComponent(direction)}`,
    form,
    { timeoutMs: 90_000 }
  )
}

export function electronicInvoiceSourceFileUrl(invoiceId: string, inline = true): string {
  return `/api/electronic-invoices/${encodeURIComponent(invoiceId)}/file?inline=${inline ? 'true' : 'false'}`
}

/** API 行 -> 前端发票记录（与 useInvoiceStore / InvoiceForm 字段一致） */
export function apiInvoiceRowToFrontend(row: ApiInvoiceRow): Record<string, unknown> {
  const amt = row.invoice_amount
  const tax = Number.isFinite(row.tax_amount) ? row.tax_amount : 0
  const withTax = Number.isFinite(row.amount_with_tax) ? row.amount_with_tax : amt + tax
  return {
    id: row.id != null ? String(row.id) : '',
    invoiceDirection: row.invoice_direction || 'output',
    invoiceType: row.invoice_type ?? '',
    digitalInvoiceNo: row.digital_invoice_no ?? '',
    invoiceCode: row.invoice_code ?? '',
    invoiceNo: row.invoice_no ?? '',
    invoiceIdentityKey: row.invoice_identity_key ?? '',
    buyerName: row.buyer_name ?? row.title ?? '',
    buyerTaxNo: row.buyer_tax_no ?? row.tax_no ?? '',
    sellerName: row.seller_name ?? '',
    sellerTaxNo: row.seller_tax_no ?? '',
    title: row.title ?? '',
    taxNo: row.tax_no ?? '',
    amount: Number.isFinite(amt) ? amt.toFixed(2) : '0.00',
    taxAmount: Number.isFinite(tax) ? tax.toFixed(2) : '0.00',
    amountWithTax: Number.isFinite(withTax) ? withTax.toFixed(2) : '0.00',
    taxRate: row.tax_rate == null ? '' : String(row.tax_rate),
    issueDate: row.invoice_date ?? '',
    issuer: row.issuer ?? '',
    invoiceSource: row.invoice_source ?? '',
    sourceFileName: row.source_file_name ?? '',
    sourceFileUrl: row.source_file_url ?? '',
    sourceFileType: row.source_file_type ?? '',
    sourceFileSize: row.source_file_size ?? 0,
    taxStatus: row.tax_status || 'normal',
    originalInvoiceId: row.original_invoice_id ?? '',
    status: row.status || '未开',
    remark: row.remark != null ? String(row.remark) : '',
    verified: Boolean(row.verified),
    verifiedAmount: Number.isFinite(row.verified_amount) ? row.verified_amount : 0,
    verifiedRecordIds: Array.isArray(row.verified_record_ids) ? row.verified_record_ids.map(String) : []
  }
}

/** 前端记录 -> API 写入体 */
export function frontendInvoiceRecordToPayload(record: Record<string, unknown>): InvoiceRecordPayload {
  const idsRaw = record.verifiedRecordIds
  const ids = Array.isArray(idsRaw) ? idsRaw.map(String) : []
  const va = record.verifiedAmount ?? record.verified_amount
  const verifiedAmt = typeof va === 'number' && Number.isFinite(va) ? va : parseFloat(String(va ?? 0)) || 0
  const displayStatus = (record.status as string) || '未开'
  const derivedTaxStatus = displayStatus === '作废' ? 'void' : displayStatus.includes('红') ? 'red' : 'normal'
  const taxRateRaw = record.taxRate ?? record.tax_rate
  const taxRate = taxRateRaw === '' || taxRateRaw == null ? null : Number(taxRateRaw)
  return {
    invoice_direction: String(record.invoiceDirection || record.invoice_direction || 'output') === 'input' ? 'input' : 'output',
    invoice_type: (record.invoiceType as string) || null,
    digital_invoice_no: (record.digitalInvoiceNo as string) || null,
    invoice_code: (record.invoiceCode as string) || null,
    invoice_no: (record.invoiceNo as string) || null,
    invoice_identity_key: (record.invoiceIdentityKey as string) || null,
    buyer_name: (record.buyerName as string) || (record.title as string) || null,
    buyer_tax_no: (record.buyerTaxNo as string) || (record.taxNo as string) || null,
    seller_name: (record.sellerName as string) || null,
    seller_tax_no: (record.sellerTaxNo as string) || null,
    title: (record.title as string) || null,
    tax_no: (record.taxNo as string) || null,
    invoice_amount: parseFloat(String(record.amount ?? 0)) || 0,
    tax_amount: parseFloat(String(record.taxAmount ?? 0)) || 0,
    amount_with_tax: parseFloat(String(record.amountWithTax ?? 0)) || (parseFloat(String(record.amount ?? 0)) || 0) + (parseFloat(String(record.taxAmount ?? 0)) || 0),
    tax_rate: Number.isFinite(taxRate) ? taxRate : null,
    invoice_date: (record.issueDate as string) || null,
    issuer: (record.issuer as string) || null,
    invoice_source: (record.invoiceSource as string) || null,
    source_file_name: (record.sourceFileName as string) || null,
    source_file_url: (record.sourceFileUrl as string) || null,
    source_file_type: (record.sourceFileType as string) || null,
    source_file_size: Number(record.sourceFileSize || 0) || null,
    tax_status: (record.taxStatus as string) || derivedTaxStatus,
    original_invoice_id: (record.originalInvoiceId as string) || null,
    status: displayStatus,
    remark: record.remark != null && String(record.remark).trim() !== '' ? String(record.remark) : null,
    verified: Boolean(record.verified),
    verified_amount: verifiedAmt,
    verified_record_ids: ids
  }
}

export function getInvoiceRecordId(record: Record<string, unknown> | null | undefined): string {
  if (record == null) return ''
  const v = record.id
  return v === undefined || v === null || v === '' ? '' : String(v)
}
