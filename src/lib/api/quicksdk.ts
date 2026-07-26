/**
 * QuickSDK flow library API.
 */

import { ApiError, apiGet, apiPost } from '@/lib/api/client.ts'

const PATH = '/api/quicksdk'
const READ_OPTIONS = { timeoutMs: 30_000 }

export type QuickSdkSummaryResponse = {
  batch_count: number
  row_count: number
  game_count: number
  channel_count: number
  total_flow: number
}

export type QuickSdkBatch = {
  id: string
  source_file?: string | null
  settlement_month?: string | null
  row_count: number
  game_count: number
  channel_count: number
  total_flow: number
  note?: string | null
  imported_at: string
}

export type QuickSdkBatchListResponse = {
  items: QuickSdkBatch[]
  total: number
}

export type QuickSdkFlowRow = {
  id?: string
  batch_id?: string
  flow_date?: string | null
  settlement_month?: string | null
  game_name?: string | null
  channel_name?: string | null
  gross_flow?: number | string | null
  created_at?: string
}

export type QuickSdkFlowListResponse = {
  items: QuickSdkFlowRow[]
  total: number
}

export type QuickSdkRankItem = {
  name: string
  flow: number
  row_count: number
  percentage?: number
}

export type QuickSdkAnalyticsResponse = {
  game_rankings?: QuickSdkRankItem[]
  channel_rankings?: QuickSdkRankItem[]
  monthly?: Array<{
    settlement_month: string
    row_count: number
    game_count: number
    channel_count: number
    total_flow: number | string
  }>
}

export type QuickSdkRdLineSuggestion = {
  game_name: string
  settlement_month: string | null
  row_count: number
  channel_count: number
  source_game_count: number
  total_flow: number
  top_channel: string | null
  top_channel_flow: number
}

export type QuickSdkRdLineListResponse = {
  items: QuickSdkRdLineSuggestion[]
  total: number
}

export type QuickSdkGameFlowResponse = QuickSdkRdLineSuggestion

function queryString(params: Record<string, unknown> = {}): string {
  const q = new URLSearchParams()
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null) continue
    const value = String(raw).trim()
    if (value) q.set(key, value)
  }
  const qs = q.toString()
  return qs ? `?${qs}` : ''
}

export function getQuickSdkSummary(params: { settlement_month?: string } = {}) {
  return apiGet<QuickSdkSummaryResponse>(`${PATH}/summary${queryString(params)}`, READ_OPTIONS)
}

export function listQuickSdkBatches(params: {
  settlement_month?: string
  limit?: number
  offset?: number
} = {}) {
  return apiGet<QuickSdkBatchListResponse>(`${PATH}/batches${queryString(params)}`, READ_OPTIONS)
}

export async function listQuickSdkFlows(params: {
  settlement_month?: string
  game_name?: string
  channel_name?: string
  q?: string
  limit?: number
  offset?: number
} = {}) {
  const hasClientFilter = Boolean(params.q || params.game_name || params.channel_name)
  const requestParams = hasClientFilter
    ? { ...params, limit: Math.max(Number(params.limit || 0), 1000), offset: 0 }
    : params
  const response = await apiGet<QuickSdkFlowListResponse>(
    `${PATH}/flows${queryString(requestParams)}`,
    READ_OPTIONS
  )

  if (!hasClientFilter) return response

  const keyword = String(params.q || '').trim().toLowerCase()
  const gameName = String(params.game_name || '').trim().toLowerCase()
  const channelName = String(params.channel_name || '').trim().toLowerCase()
  const filtered = (response.items || []).filter((row) => {
    const game = String(row.game_name || '').trim().toLowerCase()
    const channel = String(row.channel_name || '').trim().toLowerCase()
    const matchesKeyword = !keyword || game.includes(keyword) || channel.includes(keyword)
    const matchesGame = !gameName || game.includes(gameName)
    const matchesChannel = !channelName || channel.includes(channelName)
    return matchesKeyword && matchesGame && matchesChannel
  })
  const offset = Math.max(Number(params.offset || 0), 0)
  const limit = Math.max(Number(params.limit || filtered.length), 0)

  return {
    ...response,
    items: filtered.slice(offset, offset + limit),
    total: filtered.length
  }
}

export function getQuickSdkAnalytics(params: { settlement_month?: string } = {}) {
  return apiGet<QuickSdkAnalyticsResponse>(`${PATH}/analytics${queryString(params)}`, READ_OPTIONS)
    .then(normalizeAnalytics)
    .catch(async (error) => {
      if (!(error instanceof ApiError) || error.status !== 404) throw error
      return buildAnalyticsFromFlows(params)
    })
}

export function importQuickSdkFlows(body: {
  source_file?: string
  settlement_month?: string
  note?: string
  rows: Array<{
    flow_date?: string
    settlement_month?: string
    game_name: string
    channel_name: string
    gross_flow: number
  }>
}) {
  return apiPost<QuickSdkBatch>(`${PATH}/imports`, body)
}

export function listQuickSdkRdLines(params: {
  settlement_month?: string
  q?: string
  limit?: number
}): Promise<QuickSdkRdLineListResponse> {
  return apiGet<QuickSdkRdLineListResponse>(
    `${PATH}/rd-lines${queryString(params)}`,
    READ_OPTIONS
  ).catch(
    async (error) => {
      if (!(error instanceof ApiError) || error.status !== 404) throw error
      return listQuickSdkRdLinesFromFlows(params)
    }
  )
}

export function getQuickSdkGameFlow(params: {
  settlement_month?: string
  game_name: string
}): Promise<QuickSdkGameFlowResponse> {
  return apiGet<QuickSdkGameFlowResponse>(
    `${PATH}/game-flow${queryString(params)}`,
    READ_OPTIONS
  )
}

async function buildAnalyticsFromFlows(params: { settlement_month?: string }) {
  const response = await listQuickSdkFlows({ settlement_month: params.settlement_month, limit: 1000 })
  const total = response.items.reduce((sum, row) => sum + safeNumber(row.gross_flow), 0)
  return {
    game_rankings: rankRows(response.items, 'game_name', total),
    channel_rankings: rankRows(response.items, 'channel_name', total)
  }
}

async function listQuickSdkRdLinesFromFlows(params: {
  settlement_month?: string
  q?: string
  limit?: number
}): Promise<QuickSdkRdLineListResponse> {
  const limit = Math.max(Number(params.limit || 300), 300)
  const response = await listQuickSdkFlows({ settlement_month: params.settlement_month, limit })
  const keyword = String(params.q || '').trim().toLowerCase()
  const groups = new Map<
    string,
    {
      settlement_month: string | null
      row_count: number
      total_flow: number
      source_games: Set<string>
      channels: Map<string, number>
    }
  >()

  for (const row of response.items || []) {
    const sourceGame = String(row.game_name || '').trim()
    if (!sourceGame) continue
    const gameName = normalizeGameName(sourceGame)
    if (keyword && !gameName.toLowerCase().includes(keyword) && !sourceGame.toLowerCase().includes(keyword)) {
      continue
    }
    const channelName = String(row.channel_name || '').trim() || '未填渠道'
    const flow = safeNumber(row.gross_flow)
    const group =
      groups.get(gameName) ||
      {
        settlement_month: row.settlement_month || params.settlement_month || null,
        row_count: 0,
        total_flow: 0,
        source_games: new Set<string>(),
        channels: new Map<string, number>()
      }

    group.row_count += 1
    group.total_flow += flow
    group.source_games.add(sourceGame)
    group.channels.set(channelName, (group.channels.get(channelName) || 0) + flow)
    groups.set(gameName, group)
  }

  const items = Array.from(groups.entries())
    .map(([gameName, group]) => {
      const [topChannel, topChannelFlow] =
        Array.from(group.channels.entries()).sort((a, b) => b[1] - a[1])[0] || [null, 0]
      return {
        game_name: gameName,
        settlement_month: group.settlement_month,
        row_count: group.row_count,
        channel_count: group.channels.size,
        source_game_count: group.source_games.size,
        total_flow: Number(group.total_flow.toFixed(2)),
        top_channel: topChannel,
        top_channel_flow: Number(topChannelFlow.toFixed(2))
      }
    })
    .sort((a, b) => b.total_flow - a.total_flow)

  return {
    items: items.slice(0, params.limit || items.length),
    total: items.length
  }
}

function rankRows(rows: QuickSdkFlowRow[], key: 'game_name' | 'channel_name', total: number) {
  const groups = new Map<string, { flow: number; row_count: number }>()
  for (const row of rows || []) {
    const name = String(row[key] || '未填写').trim() || '未填写'
    const item = groups.get(name) || { flow: 0, row_count: 0 }
    item.flow += safeNumber(row.gross_flow)
    item.row_count += 1
    groups.set(name, item)
  }
  return Array.from(groups.entries())
    .map(([name, item]) => ({
      name,
      flow: Number(item.flow.toFixed(2)),
      row_count: item.row_count,
      percentage: total > 0 ? Number(((item.flow / total) * 100).toFixed(1)) : 0
    }))
    .sort((a, b) => b.flow - a.flow)
}

function normalizeAnalytics(response: QuickSdkAnalyticsResponse & {
  game_rankings?: Array<QuickSdkRankItem & { total_flow?: number | string; share_rate?: number }>
  channel_rankings?: Array<QuickSdkRankItem & { total_flow?: number | string; share_rate?: number }>
}): QuickSdkAnalyticsResponse {
  const normalizeRows = (
    rows: Array<QuickSdkRankItem & { total_flow?: number | string; share_rate?: number }> = []
  ) =>
    rows.map((row) => ({
      name: row.name,
      flow: safeNumber(row.flow ?? row.total_flow),
      row_count: Number(row.row_count || 0),
      percentage: Number(safeNumber(row.percentage ?? row.share_rate).toFixed(1))
    }))

  return {
    ...response,
    game_rankings: normalizeRows(response.game_rankings),
    channel_rankings: normalizeRows(response.channel_rankings)
  }
}

function normalizeGameName(value: string): string {
  return value
    .replace(/005专服\d+.*/u, '')
    .replace(/005折混服.*$/u, '')
    .replace(/005$/u, '')
    .trim()
}

function safeNumber(value: unknown): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}
