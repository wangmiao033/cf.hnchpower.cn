import { apiGet } from '@/lib/api/client.ts'

export type GlobalSearchKind =
  | 'rd_bill'
  | 'channel_bill'
  | 'contract'
  | 'invoice'
  | 'partner'
  | 'bank_transaction'

export type GlobalSearchTarget = {
  action: 'bill360' | 'contract_detail' | 'invoice_detail' | 'partner_focus' | 'bank_detail'
  view: string
  entity_id: string
  bill_type?: 'rd' | 'channel' | null
  direction?: 'input' | 'output' | null
  focus_query?: string | null
}

export type GlobalSearchResult = {
  id: string
  kind: GlobalSearchKind
  title: string
  subtitle?: string | null
  meta?: string | null
  badge?: string | null
  amount?: number | null
  status?: string | null
  score: number
  matched_fields: string[]
  target: GlobalSearchTarget
}

export type GlobalSearchResponse = {
  query: string
  total: number
  results: GlobalSearchResult[]
  groups: Array<{ kind: GlobalSearchKind; count: number }>
}

export function globalSearch(query: string, limit = 30) {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  return apiGet<GlobalSearchResponse>(`/api/global-search?${params.toString()}`, { timeoutMs: 12_000 })
}
