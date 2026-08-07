import { apiGet } from '@/lib/api/client.ts'

export type BusinessMetric = {
  value: number
  previous_value: number
  change_amount: number
  change_percent: number | null
}

export type MonthlyBusinessTrendItem = {
  month: string
  channel_settlement: number
  rd_settlement: number
  server_cost: number
  contribution: number
  contribution_margin: number
  channel_receipts: number
  rd_payments: number
  cash_net: number
}

export type MonthlyBusinessGameItem = {
  game_name: string
  channel_settlement: number
  rd_settlement: number
  contribution_before_server: number
  channel_flow: number
  rd_flow: number
}

export type MonthlyBusinessDashboard = {
  month: string
  previous_month: string
  available_months: string[]
  latest_month?: string | null
  channel_settlement: BusinessMetric
  rd_settlement: BusinessMetric
  server_cost: BusinessMetric
  contribution: BusinessMetric
  contribution_margin: BusinessMetric
  channel_receipts: BusinessMetric
  rd_payments: BusinessMetric
  cash_net: BusinessMetric
  channel_outstanding: BusinessMetric
  channel_bill_count: number
  rd_bill_count: number
  channel_completed_count: number
  rd_completed_count: number
  trend: MonthlyBusinessTrendItem[]
  games: MonthlyBusinessGameItem[]
  notes: string[]
}

export function getMonthlyBusinessDashboard(params: {
  month?: string
  trendMonths?: number
} = {}): Promise<MonthlyBusinessDashboard> {
  const query = new URLSearchParams()
  if (params.month) query.set('month', params.month)
  if (params.trendMonths != null) query.set('trend_months', String(params.trendMonths))
  const qs = query.toString()
  return apiGet(`/api/business-dashboard/monthly${qs ? `?${qs}` : ''}`)
}
