import { apiGet } from '@/lib/api/client.ts'

export type OperationLogChangeValue = {
  before?: unknown
  after?: unknown
}

export type OperationLogRow = {
  id: string
  entity_type: 'rd' | 'channel' | string
  entity_id: string
  entity_number?: string | null
  action: string
  summary: string
  actor_user_id?: string | null
  actor_email?: string | null
  changes: Record<string, OperationLogChangeValue>
  metadata?: Record<string, unknown>
  created_at: string
}

export type OperationLogListResponse = {
  items: OperationLogRow[]
  total: number
}

export function listOperationLogs(params: {
  entity_type?: string
  entity_id?: string
  action?: string
  include_related?: boolean
  limit?: number
  offset?: number
} = {}): Promise<OperationLogListResponse> {
  const query = new URLSearchParams()
  if (params.entity_type) query.set('entity_type', params.entity_type)
  if (params.entity_id) query.set('entity_id', params.entity_id)
  if (params.action) query.set('action', params.action)
  if (params.include_related) query.set('include_related', 'true')
  if (params.limit != null) query.set('limit', String(params.limit))
  if (params.offset != null) query.set('offset', String(params.offset))
  const qs = query.toString()
  return apiGet<OperationLogListResponse>(`/api/operation-logs${qs ? `?${qs}` : ''}`)
}
