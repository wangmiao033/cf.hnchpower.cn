import { apiPost } from '@/lib/api/client.ts'

export type BillInvoiceOverviewKey = {
  key: string
  bill_type: 'rd' | 'channel'
  bill_id: string
}

export type BillInvoiceOverviewRow = {
  key: string
  bill_type: 'rd' | 'channel'
  bill_id: string
  bill_amount: number
  allocated_amount: number
  remaining_amount: number
  coverage_percent: number
  coverage_status: 'none' | 'partial' | 'complete' | 'over'
  allocation_count: number
}

export function getBillInvoiceOverviews(keys: BillInvoiceOverviewKey[]): Promise<BillInvoiceOverviewRow[]> {
  const seen = new Set<string>()
  const normalized = (keys || [])
    .map((item) => ({
      key: String(item?.key || '').trim(),
      bill_type: item?.bill_type === 'channel' ? 'channel' as const : 'rd' as const,
      bill_id: String(item?.bill_id || '').trim()
    }))
    .filter((item) => {
      const signature = `${item.bill_type}:${item.bill_id}`
      if (!item.key || !item.bill_id || seen.has(signature)) return false
      seen.add(signature)
      return true
    })
    .slice(0, 200)

  if (!normalized.length) return Promise.resolve([])
  return apiPost<{ items: BillInvoiceOverviewRow[] }>(
    '/api/reconciliation/bill-invoice-overviews',
    { keys: normalized }
  ).then((result) => result.items || [])
}
