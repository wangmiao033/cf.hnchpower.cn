import { apiGet, apiPost } from '@/lib/api/client.ts'

const PATH = '/api/game-registry'

export type GameRegistryPreviewSummary = {
  source_line_count: number
  game_count: number
  rule_period_count: number
  conflict_count: number
  legacy_records_without_line_items?: number
}

export type GameRegistryPreviewGame = {
  canonical_name: string
  normalized_name: string
  occurrences: number
  display_variants: string[]
  channel_count: number
  channels: Array<{ partner_name: string; channel_name: string }>
}

export type GameRegistryPreviewRule = {
  partner_name: string
  channel_name: string
  game_name: string
  normalized_name: string
  start_month: string
  end_month: string
  share_rate?: string | number | null
  tax_rate?: string | number | null
  channel_fee_rate?: string | number | null
  settlement_rule_code?: string | null
  channel_fee_mode?: string | null
  tax_mode?: string | null
  source_months: string[]
  source_count: number
  source_first_bill_id?: string | null
  source_last_bill_id?: string | null
}

export type GameRegistryPreviewConflictVariant = {
  share_rate?: string | number | null
  tax_rate?: string | number | null
  channel_fee_rate?: string | number | null
  settlement_rule_code?: string | null
  channel_fee_mode?: string | null
  tax_mode?: string | null
  count: number
  bill_ids: string[]
}

export type GameRegistryPreviewConflict = {
  partner_name: string
  channel_name: string
  game_name: string
  normalized_name: string
  month: string
  variants: GameRegistryPreviewConflictVariant[]
}

export type GameRegistryHistoryPreview = {
  summary: GameRegistryPreviewSummary
  games: GameRegistryPreviewGame[]
  rules: GameRegistryPreviewRule[]
  conflicts: GameRegistryPreviewConflict[]
  safety: {
    historical_bills_mutated: boolean
    history_is_source_of_truth: boolean
    rule_periods_only_merge_consecutive_months: boolean
  }
  filters?: {
    partner_name?: string | null
    channel_name?: string | null
    confirmed_only?: boolean
  }
}

export type GameIdentity = {
  input_name: string
  normalized_name: string
  game_id: string | null
  canonical_name: string | null
  source: 'canonical' | 'alias' | 'unmapped' | string
}

export type GameIdentityResolveResponse = {
  items: GameIdentity[]
  total: number
}

export type GameAliasMapResponse = {
  ok: boolean
  alias_name: string
  normalized_alias: string
  game_id: string
  canonical_name: string
  already_mapped: boolean
}

function queryString(params: Record<string, unknown> = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, raw]) => {
    if (raw === undefined || raw === null || raw === '') return
    query.set(key, String(raw))
  })
  const value = query.toString()
  return value ? `?${value}` : ''
}

export function getGameRegistryHistoryPreview(params: {
  partner_name?: string
  channel_name?: string
  confirmed_only?: boolean
} = {}) {
  return apiGet<GameRegistryHistoryPreview>(`${PATH}/history-preview${queryString(params)}`, {
    timeoutMs: 60_000
  })
}

export function resolveGameIdentities(names: string[]): Promise<GameIdentityResolveResponse> {
  return apiPost<GameIdentityResolveResponse>(`${PATH}/resolve`, { names })
}

export function mapGameAlias(payload: {
  alias_name: string
  target_name: string
  target_game_id?: string
  access_item_id?: string
}): Promise<GameAliasMapResponse> {
  return apiPost<GameAliasMapResponse>(`${PATH}/aliases/map`, payload)
}
