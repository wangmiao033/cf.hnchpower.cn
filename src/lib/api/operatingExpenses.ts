import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api/client.ts'

export type OperatingExpense = {
  id: string
  expense_month: string
  expense_date?: string | null
  category: string
  expense_kind: string
  amount: number
  game_name?: string | null
  vendor_name?: string | null
  due_date?: string | null
  payment_date?: string | null
  payment_status: string
  invoice_status: string
  invoice_number?: string | null
  voucher_note?: string | null
  remark?: string | null
  source: string
  created_at: string
  updated_at: string
}

export type OperatingExpensePayload = {
  expense_month: string
  expense_date?: string | null
  category: string
  expense_kind?: string
  amount: number
  game_name?: string | null
  vendor_name?: string | null
  due_date?: string | null
  payment_date?: string | null
  payment_status?: string
  invoice_status?: string
  invoice_number?: string | null
  voucher_note?: string | null
  remark?: string | null
  source?: string
}

export type OperatingExpenseListResponse = {
  items: OperatingExpense[]
  total: number
  amount_total: number
}

export type OperatingDeposit = {
  id: string
  deposit_type: string
  title: string
  counterparty?: string | null
  amount: number
  paid_date?: string | null
  expected_refund_date?: string | null
  status: string
  refund_date?: string | null
  remark?: string | null
  created_at: string
  updated_at: string
}

export type OperatingDepositPayload = {
  deposit_type?: string
  title: string
  counterparty?: string | null
  amount: number
  paid_date?: string | null
  expected_refund_date?: string | null
  status?: string
  refund_date?: string | null
  remark?: string | null
}

export type OperatingDepositListResponse = {
  items: OperatingDeposit[]
  total: number
  amount_total: number
}

export function listOperatingExpenses(params: {
  month?: string
  category?: string
  expenseKind?: string
  gameName?: string
  q?: string
  limit?: number
  offset?: number
} = {}): Promise<OperatingExpenseListResponse> {
  const query = new URLSearchParams()
  if (params.month) query.set('month', params.month)
  if (params.category) query.set('category', params.category)
  if (params.expenseKind) query.set('expense_kind', params.expenseKind)
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

export function listOperatingDeposits(params: {
  status?: string
  depositType?: string
  q?: string
  limit?: number
  offset?: number
} = {}): Promise<OperatingDepositListResponse> {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.depositType) query.set('deposit_type', params.depositType)
  if (params.q) query.set('q', params.q)
  query.set('limit', String(params.limit ?? 200))
  query.set('offset', String(params.offset ?? 0))
  return apiGet(`/api/operating-expenses/deposits?${query.toString()}`)
}

export function createOperatingDeposit(payload: OperatingDepositPayload): Promise<OperatingDeposit> {
  return apiPost('/api/operating-expenses/deposits', payload)
}

export function updateOperatingDeposit(
  id: string,
  payload: Partial<OperatingDepositPayload>
): Promise<OperatingDeposit> {
  return apiPut(`/api/operating-expenses/deposits/${encodeURIComponent(id)}`, payload)
}

export function deleteOperatingDeposit(id: string): Promise<void> {
  return apiDelete(`/api/operating-expenses/deposits/${encodeURIComponent(id)}`)
}
