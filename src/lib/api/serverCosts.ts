import { apiGet, apiPost, apiPut } from '@/lib/api/client.ts'

export type ServerCost = {
  id: string
  expense_month: string
  expense_date?: string | null
  provider_name?: string | null
  category: string
  amount: number
  game_name?: string | null
  payer_entity?: string | null
  remark?: string | null
  source: string
  status: 'active' | 'void' | string
  void_reason?: string | null
  voided_at?: string | null
  created_at: string
  updated_at: string
}

export type ServerCostPayload = {
  expense_month: string
  expense_date?: string | null
  provider_name?: string | null
  category: string
  amount: number
  game_name?: string | null
  payer_entity?: string | null
  remark?: string | null
  source?: string
}

export type ServerCostListResponse = {
  items: ServerCost[]
  total: number
  amount_total: number
}

const BASE = '/api/operating-expenses/server-costs'

export function listServerCosts(params: {
  month?: string
  category?: string
  gameName?: string
  q?: string
  status?: 'active' | 'void' | 'all'
  limit?: number
  offset?: number
} = {}): Promise<ServerCostListResponse> {
  const query = new URLSearchParams()
  if (params.month) query.set('month', params.month)
  if (params.category) query.set('category', params.category)
  if (params.gameName) query.set('game_name', params.gameName)
  if (params.q) query.set('q', params.q)
  if (params.status) query.set('status', params.status)
  query.set('limit', String(params.limit ?? 300))
  query.set('offset', String(params.offset ?? 0))
  return apiGet(`${BASE}?${query.toString()}`)
}

export function createServerCost(payload: ServerCostPayload): Promise<ServerCost> {
  return apiPost(BASE, payload)
}

export function updateServerCost(id: string, payload: Partial<ServerCostPayload>): Promise<ServerCost> {
  return apiPut(`${BASE}/${encodeURIComponent(id)}`, payload)
}

export function voidServerCost(id: string, reason?: string): Promise<ServerCost> {
  return apiPost(`${BASE}/${encodeURIComponent(id)}/void`, { reason: reason || null })
}

export function restoreServerCost(id: string): Promise<ServerCost> {
  return apiPost(`${BASE}/${encodeURIComponent(id)}/restore`, {})
}
