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

export type WorkbenchTodoResponse = {
  generated_at: string
  summary: WorkbenchTodoSummary
  items: WorkbenchTodoItem[]
  visible_modules: string[]
}

export function getWorkbenchTodos() {
  return apiGet<WorkbenchTodoResponse>('/api/workbench/todos')
}
