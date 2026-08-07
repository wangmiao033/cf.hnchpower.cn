import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api/client.ts'

export type OperatingExpense = {
  id: string
  expense_month: string
  expense_date?: string | null
  category: string
  amount: number
  game_name?: string | null
  vendor_name?: string | null
  remark?: string | null
  source: string
  created_at: string
  updated_at: string
}

export type OperatingExpensePayload = {
  expense_month: string
  expense_date?: string | null
  category: string
  amount: number
  game_name?: string | null
  vendor_name?: string | null
  remark?: string | null
  source?: string
}

export type OperatingExpenseListResponse = {
  items: OperatingExpense[]
  total: number
  amount_total: number
}

export function listOperatingExpenses(params: {
  month?: string
  category?: string
  gameName?: string
  q?: string
  limit?: number
  offset?: number
} = {}): Promise<OperatingExpenseListResponse> {
  const query = new URLSearchParams()
  if (params.month) query.set('month', params.month)
  if (params.category) query.set('category', params.category)
  if (params.gameName) query.set('game_name', params.gameName)
  if (params.q) query.set('q', params.q)
  query.set('limit', String(params.limit ?? 200))
  query.set('offset', String(params.offset ?? 0))
  return apiGet(`/api/operating-expenses?${query.toString()}`)
}

export function createOperatingExpense(payload: OperatingExpensePayload): Promise<OperatingExpense> {
  return apiPost('/api/operating-expenses', payload)
}

export function updateOperatingExpense(
  id: string,
  payload: Partial<OperatingExpensePayload>
): Promise<OperatingExpense> {
  return apiPut(`/api/operating-expenses/${encodeURIComponent(id)}`, payload)
}

export function deleteOperatingExpense(id: string): Promise<void> {
  return apiDelete(`/api/operating-expenses/${encodeURIComponent(id)}`)
}
