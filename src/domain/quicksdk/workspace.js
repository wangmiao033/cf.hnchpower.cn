export const DATABASE_PAGE_SIZES = [20, 50, 100]

export function buildQuickSdkFlowParams({
  month,
  keyword = '',
  scope = 'all',
  page = 0,
  pageSize = 20
} = {}) {
  const safePage = Math.max(Number(page) || 0, 0)
  const safePageSize = Math.max(Number(pageSize) || 20, 1)
  const params = {
    settlement_month: month,
    limit: safePageSize,
    offset: safePage * safePageSize
  }
  const query = String(keyword || '').trim()
  if (!query) return params
  if (scope === 'game') params.game_name = query
  else if (scope === 'channel') params.channel_name = query
  else params.q = query
  return params
}

export function buildQuickSdkBatchParams({ month, page = 0, pageSize = 20 } = {}) {
  const safePage = Math.max(Number(page) || 0, 0)
  const safePageSize = Math.max(Number(pageSize) || 20, 1)
  return {
    settlement_month: month,
    limit: safePageSize,
    offset: safePage * safePageSize
  }
}

export function getDatabaseViewCounts({ summary, flowTotal = 0, batchTotal = 0, hasSearch = false } = {}) {
  return {
    overview: Number(summary?.game_count || 0) + Number(summary?.channel_count || 0),
    flows: hasSearch ? Number(flowTotal || 0) : Number(summary?.row_count || flowTotal || 0),
    imports: Number(summary?.batch_count || batchTotal || 0)
  }
}

export function getPagerRange(page, total, pageSize) {
  const safeTotal = Math.max(Number(total) || 0, 0)
  const safePageSize = Math.max(Number(pageSize) || 1, 1)
  const totalPages = Math.max(Math.ceil(safeTotal / safePageSize), 1)
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1)
  return {
    totalPages,
    safePage,
    start: safeTotal > 0 ? safePage * safePageSize + 1 : 0,
    end: Math.min((safePage + 1) * safePageSize, safeTotal)
  }
}
