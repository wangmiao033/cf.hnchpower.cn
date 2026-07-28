import { apiGet, apiPost } from '@/lib/api/client.ts'

const PATH = '/api/product-sources'

export type ProductSourceRow = {
  id: string
  game_name: string
  product_code: string
  source_file?: string | null
  created_at: string
  updated_at: string
}

export type ProductSourceListResponse = {
  items: ProductSourceRow[]
  total: number
  latest_import_at?: string | null
}

export type ProductSourceImportResponse = {
  inserted: number
  updated: number
  skipped: number
  total: number
}

function queryString(params: Record<string, unknown> = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, raw]) => {
    if (raw === undefined || raw === null) return
    const value = String(raw).trim()
    if (value) query.set(key, value)
  })
  const value = query.toString()
  return value ? `?${value}` : ''
}

export function listProductSources(params: { q?: string; limit?: number; offset?: number } = {}) {
  return apiGet<ProductSourceListResponse>(`${PATH}${queryString(params)}`, {
    timeoutMs: 30_000
  })
}

export function importProductSources(payload: {
  source_file: string
  rows: Array<{ game_name: string; product_code: string }>
}) {
  return apiPost<ProductSourceImportResponse>(`${PATH}/import`, payload)
}
