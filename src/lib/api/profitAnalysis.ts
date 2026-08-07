import { apiGet } from '@/lib/api/client.ts'

export type ProfitMetric = {
  value: number
  previous_value: number
  change_amount: number
  change_percent: number | null
}

export type ProfitTrendRow = {
  month: string
  channel_settlement: number
  rd_cost: number
  server_cost: number
  operating_expense: number
  operating_profit: number
  profit_margin: number
}

export type ProfitExpenseCategoryRow = {
  category: string
  amount: number
  share_percent: number
}

export type ProfitGameRow = {
  game_name: string
  channel_settlement: number
  rd_cost: number
  server_cost_allocated: number
  attributed_expense: number
  attributable_profit: number
  attributable_margin: number
  channel_flow: number
  rd_flow: number
}

export type ProfitAnalysis = {
  month: string
  previous_month: string
  available_months: string[]
  latest_month?: string | null
  channel_settlement: ProfitMetric
  rd_cost: ProfitMetric
  server_cost: ProfitMetric
  operating_expense: ProfitMetric
  pre_expense_contribution: ProfitMetric
  operating_profit: ProfitMetric
  profit_margin: ProfitMetric
  shared_expense: ProfitMetric
  attributed_expense: ProfitMetric
  channel_bill_count: number
  rd_bill_count: number
  expense_count: number
  expense_categories: ProfitExpenseCategoryRow[]
  games: ProfitGameRow[]
  trend: ProfitTrendRow[]
  notes: string[]
}

export function getProfitAnalysis(params: {
  month?: string
  trendMonths?: number
} = {}): Promise<ProfitAnalysis> {
  const query = new URLSearchParams()
  if (params.month) query.set('month', params.month)
  if (params.trendMonths != null) query.set('trend_months', String(params.trendMonths))
  const qs = query.toString()
  return apiGet(`/api/profit-analysis/monthly${qs ? `?${qs}` : ''}`)
}
