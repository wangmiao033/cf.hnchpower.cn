import { apiGet } from '@/lib/api/client.ts'

export type AnomalyBillRef = {
  bill_type: 'rd' | 'channel'
  bill_id: string
}

export type BillInvoiceOverview = AnomalyBillRef & {
  bill_amount: number
  allocated_amount: number
  remaining_amount: number
  coverage_percent: number
  coverage_status: 'none' | 'partial' | 'complete' | 'over'
  allocation_count: number
}

export type SystemConsistencyIssue = {
  id: string
  severity: 'critical' | 'warning' | 'info' | string
  category: 'lifecycle' | 'invoice' | 'funding' | 'archive' | 'reference' | string
  title: string
  detail: string
  bill_type?: 'rd' | 'channel' | null
  bill_id?: string | null
  bill_number?: string | null
  partner_name?: string | null
  settlement_month?: string | null
  amount?: number | null
  target_view?: string | null
  source_id?: string | null
}

export type SystemConsistencyAudit = {
  generated_at: string
  summary: {
    total: number
    critical: number
    warning: number
    info: number
    healthy: boolean
    bills_scanned: number
    invoice_allocations_scanned: number
    bank_matches_scanned: number
    archived_bills_scanned: number
    category_counts: Record<string, number>
  }
  items: SystemConsistencyIssue[]
  truncated: boolean
}

const PATH = '/api/anomaly-data'

function uniqueRefs(refs: AnomalyBillRef[]) {
  const map = new Map<string, AnomalyBillRef>()
  for (const ref of refs || []) {
    const billType = ref?.bill_type
    const billId = String(ref?.bill_id || '').trim()
    if (!billId || (billType !== 'rd' && billType !== 'channel')) continue
    map.set(`${billType}:${billId}`, { bill_type: billType, bill_id: billId })
  }
  return [...map.values()]
}

export async function listBillInvoiceOverviews(
  refs: AnomalyBillRef[]
): Promise<BillInvoiceOverview[]> {
  const unique = uniqueRefs(refs)
  if (!unique.length) return []

  const chunks: AnomalyBillRef[][] = []
  for (let index = 0; index < unique.length; index += 500) {
    chunks.push(unique.slice(index, index + 500))
  }

  const pages = await Promise.all(
    chunks.map((chunk) => {
      const billRefs = chunk.map((ref) => `${ref.bill_type}:${ref.bill_id}`).join(',')
      const query = new URLSearchParams({ bill_refs: billRefs })
      return apiGet<BillInvoiceOverview[]>(`${PATH}/bill-invoices?${query.toString()}`)
    })
  )
  return pages.flat()
}

export function getSystemConsistencyAudit(limit = 500): Promise<SystemConsistencyAudit> {
  const query = new URLSearchParams({ limit: String(limit) })
  return apiGet<SystemConsistencyAudit>(`${PATH}/consistency-audit?${query.toString()}`)
}
