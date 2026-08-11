import { apiDelete, apiGet, apiPost } from '@/lib/api/client.ts'

export type BillArchiveItem = {
  bill_id: string
  archived_at: string | null
  archived_by_email: string | null
  archive_source: 'manual' | 'auto' | string
  closure_at: string | null
}

export type BillArchiveSnapshot = {
  bill_type: 'rd' | 'channel'
  archived_ids: string[]
  eligible_ids: string[]
  items: BillArchiveItem[]
  auto_archived_count: number
  auto_archive_days: number
}

export function getBillArchiveSnapshot(billType: 'rd' | 'channel', auto = true) {
  const query = new URLSearchParams({ bill_type: billType, auto: auto ? 'true' : 'false' })
  return apiGet<BillArchiveSnapshot>(`/api/bill-lifecycle/archive?${query.toString()}`)
}

export function archiveBill(billType: 'rd' | 'channel', billId: string) {
  return apiPost(`/api/bill-lifecycle/archive/${encodeURIComponent(billType)}/${encodeURIComponent(billId)}`, {})
}

export function unarchiveBill(billType: 'rd' | 'channel', billId: string) {
  return apiDelete(`/api/bill-lifecycle/archive/${encodeURIComponent(billType)}/${encodeURIComponent(billId)}`)
}
