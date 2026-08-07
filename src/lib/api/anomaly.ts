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
