import { apiPost } from '@/lib/api/client.ts'

export type AnomalyAiInput = {
  id: string
  severity: string
  category: string
  title: string
  detail: string
  amount?: number | null
  bill_type?: string | null
  bill_id?: string | null
  bill_number?: string | null
  partner_name?: string | null
  settlement_month?: string | null
  game_name?: string | null
  status: string
}

export type AnomalyAiItemAnalysis = {
  anomaly_id: string
  priority_score: number
  priority_label: string
  confidence: number
  root_causes: string[]
  recommended_actions: string[]
  related_signals: string[]
  explanation: string
  bill_type?: 'rd' | 'channel' | null
  bill_id?: string | null
}

export type AnomalyAiSystemSignal = {
  key: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  value?: number | null
  action?: string | null
}

export type AnomalyAiAnalysisResponse = {
  engine: string
  generated_at: string
  summary: {
    risk_score: number
    health_label: string
    exposure_amount: number
    critical_count: number
    warning_count: number
    info_count: number
    narrative: string
    top_risks: string[]
    recommended_actions: string[]
  }
  system_signals: AnomalyAiSystemSignal[]
  items: AnomalyAiItemAnalysis[]
}

export function analyzeAnomalyRisks(items: AnomalyAiInput[]) {
  return apiPost<AnomalyAiAnalysisResponse>('/api/anomaly-data/ai-analysis', { items })
}
