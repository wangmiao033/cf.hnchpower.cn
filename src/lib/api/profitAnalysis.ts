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
  legacy_server_cost: ProfitMetric
  standalone_server_cost: ProfitMetric
  shared_server_cost: ProfitMetric
  attributed_server_cost: ProfitMetric
  operating_expense: ProfitMetric
  pre_expense_contribution: ProfitMetric
  operating_profit: ProfitMetric
  profit_margin: ProfitMetric
  shared_expense: ProfitMetric
  attributed_expense: ProfitMetric
  channel_bill_count: number
  rd_bill_count: number
  server_cost_count: number
  expense_count: number
  expense_categories: ProfitExpenseCategoryRow[]
  games: ProfitGameRow[]
  trend: ProfitTrendRow[]
  notes: string[]
}

export type ProjectProfitMonthRow = {
  month: string
  channel_settlement: number
  rd_cost: number
  server_cost: number
  attributed_expense: number
  total_attributable_cost: number
  gross_profit: number
  gross_margin: number
}

export type ProjectProfitRow = {
  game_name: string
  channel_settlement: number
  rd_cost: number
  server_cost: number
  attributed_expense: number
  total_attributable_cost: number
  gross_profit: number
  gross_margin: number
  channel_flow: number
  rd_flow: number
  active_months: number
  first_month: string | null
  last_month: string | null
  monthly: ProjectProfitMonthRow[]
}

export type ProjectProfitAnalysis = {
  scope: 'year' | 'lifetime'
  year: string | null
  available_years: string[]
  summary: {
    project_count: number
    profitable_projects: number
    loss_projects: number
    channel_settlement: number
    total_attributable_cost: number
    gross_profit: number
    gross_margin: number
    shared_server_cost: number
    shared_expense: number
    data_months: number
  }
  projects: ProjectProfitRow[]
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

export function getProjectProfitAnalysis(params: {
  year?: string | null
} = {}): Promise<ProjectProfitAnalysis> {
  const query = new URLSearchParams()
  if (params.year) query.set('year', params.year)
  const qs = query.toString()
  return apiGet(`/api/profit-analysis/projects${qs ? `?${qs}` : ''}`)
}
