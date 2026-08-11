import { apiGet } from '@/lib/api/client.ts'

export type WorkbenchTodoSeverity = 'critical' | 'warning' | 'info' | 'clear'

export type WorkbenchTodoItem = {
  key: string
  label: string
  count: number
  amount: number | null
  severity: WorkbenchTodoSeverity
  description: string
  detail: string | null
  target: string
  action_label: string
}

export type WorkbenchTodoSummary = {
  total_count: number
  urgent_count: number
  review_count: number
  receivable_amount: number
  payable_amount: number
  invoice_gap_amount: number
}

export type WorkbenchBillSnapshot = {
  rd_bill_count: number
  channel_bill_count: number
  rd_pending_count: number
  channel_pending_count: number
  rd_total_amount: number
  channel_total_amount: number
  latest_settlement_month: string | null
}

export type WorkbenchTodoResponse = {
  generated_at: string
  summary: WorkbenchTodoSummary
  snapshot: WorkbenchBillSnapshot
  items: WorkbenchTodoItem[]
  visible_modules: string[]
}

export function getWorkbenchTodos() {
  return apiGet<WorkbenchTodoResponse>('/api/workbench/todos')
}
