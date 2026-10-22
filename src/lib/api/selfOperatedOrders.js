import { apiGet, apiPost } from '@/lib/api/client'

const PREFIX = '/api/self-operated'

export function getDaxiongServerStatus() {
  return apiGet(`${PREFIX}/status`, { timeoutMs: 12000 })
}

export function getDaxiongServerMonth(month) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(month))) {
    throw new Error('账期格式必须是 YYYY-MM')
  }
  return apiGet(`${PREFIX}/months/${month}`, { timeoutMs: 15000 })
}

export function getDaxiongImportAudit(limit = 30) {
  return apiGet(`${PREFIX}/imports?limit=${Math.min(Math.max(1, Number(limit) || 30), 100)}`)
}

export function prepareDaxiongServerImport(imported, { statusConfirmed = false, typeConfirmed = false } = {}) {
  if (!imported || !Array.isArray(imported.records) || !imported.records.length) {
    throw new Error('没有可正式保存的订单。请先导入并核对原始 CSV 文件。')
  }
  if (!imported.draftId || !/^[0-9a-f-]{36}$/i.test(String(imported.draftId))) {
    throw new Error('订单批次标识无效，请重新导入原始文件。')
  }
  if (!imported.fileName || typeof imported.fileName !== 'string') {
    throw new Error('缺少原始文件名称')
  }
  // 旧本机草稿只保存了清洗后的标准字段，不含原始字段映射。
  // 必须通过操作人勾选确认源文件包含支付状态和业务类型。
  const mappedStatus = imported.fields?.status !== '' && imported.fields?.status != null
  const mappedType = imported.fields?.orderType !== '' && imported.fields?.orderType != null
  if (!mappedStatus && !statusConfirmed) {
    throw new Error('请确认原文件含有真实支付状态列；不能将未知状态直接入账。')
  }
  if (!mappedType && !typeConfirmed) {
    throw new Error('请确认原文件含有业务类型列；必须区分游戏与竹B充值。')
  }
  const valid = imported.records.filter(row => row.disposition === 'ready')
  if (!valid.length || valid.length > 5000) {
    throw new Error('正式入账单次最多 5,000 笔有效订单，请按月分批。')
  }
  const seen = new Set()
  const rows = valid.map(row => {
    if (!row.orderId || seen.has(row.orderId)) {
      throw new Error('存在重复或缺失的订单编号，请重新核对原始文件。')
    }
    seen.add(row.orderId)
    if (row.payment !== 'paid' || !['game', 'coin'].includes(row.kind)) {
      throw new Error('包含未确认支付状态或业务类型的订单，禁止正式入账。')
    }
    if (!Number.isSafeInteger(row.amountCents) || row.amountCents <= 0) {
      throw new Error('订单金额必须为正数且精确到分。')
    }
    if (!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(row.paidDate)) {
      throw new Error('支付日期格式无效，必须先核对日期。')
    }
    if (row.kind === 'game' && !(row.gameId || row.gameName)) {
      throw new Error('游戏充值订单缺少游戏身份。')
    }
    return {
      orderId: String(row.orderId),
      gameId: String(row.gameId || ''),
      gameName: String(row.gameName || ''),
      amountCents: row.amountCents,
      paidDate: row.paidDate,
      kind: row.kind,
      payment: 'paid',
      disposition: 'ready'
    }
  })
  const gameCents = valid.filter(row => row.kind === 'game').reduce((n,row) => n + row.amountCents, 0)
  const coinCents = valid.filter(row => row.kind === 'coin').reduce((n,row) => n + row.amountCents, 0)
  if (gameCents !== imported.summary?.gameCents || coinCents !== imported.summary?.coinCents) {
    throw new Error('当前导入草稿金额与校验汇总不一致，请重新导入。')
  }
  return {
    requestKey: imported.draftId,
    sourceFile: imported.fileName,
    sourceStatusColumnPresent: true,
    sourceTypeColumnPresent: true,
    confirmed: true,
    rows
  }
}

export async function confirmDaxiongServerImport(payload) {
  return apiPost(`${PREFIX}/imports/confirm`, payload, { timeoutMs: 90000 })
}

export function daxiongServerSummaryToReport(summary) {
  if (!summary || !summary.schema_ready) return null
  const month = summary.settlement_month || ''
  return {
    label: month.replace(/^([0-9]{4})-0?([0-9]{1,2})$/, (_,year,part) => year + '年' + Number(part) + '月'),
    orders: summary.game_orders || 0,
    cash: (summary.game_cents || 0) / 100,
    coinCash: (summary.coin_cents || 0) / 100,
    ads: [],
    spent: null,
    topup: null,
    source: 'server-ledger',
    games: (summary.games || []).map(game => ({
      id: game.game_id || '—',
      name: game.game_name || ('游戏 ID ' + game.game_id),
      cash: game.amount_cents / 100,
      orders: game.orders
    }))
  }
}
