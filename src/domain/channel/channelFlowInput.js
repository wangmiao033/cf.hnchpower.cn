export const CHANNEL_FLOW_INPUT_STATE = Object.freeze({
  MISSING: 'missing',
  CONFIRMED_ZERO: 'confirmed_zero',
  ENTERED: 'entered',
  CONFIRMED: 'confirmed'
})

export function normalizeChannelTextKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/\s+/g, '')
}

export function resolveChannelFlowInputState(row = {}) {
  const rawState = String(row?.flowInputState || row?.flow_input_state || '').trim().toLowerCase()
  const rawFlow = row?.flow ?? row?.billing_flow
  const hasFlow = rawFlow !== '' && rawFlow !== null && rawFlow !== undefined
  const value = hasFlow ? Number(rawFlow) : Number.NaN

  if (!hasFlow || !Number.isFinite(value)) return CHANNEL_FLOW_INPUT_STATE.MISSING
  if (value > 0) return CHANNEL_FLOW_INPUT_STATE.ENTERED
  if (value === 0) {
    if (rawState === CHANNEL_FLOW_INPUT_STATE.CONFIRMED_ZERO || rawState === CHANNEL_FLOW_INPUT_STATE.CONFIRMED) {
      return CHANNEL_FLOW_INPUT_STATE.CONFIRMED_ZERO
    }
    return CHANNEL_FLOW_INPUT_STATE.MISSING
  }
  return CHANNEL_FLOW_INPUT_STATE.MISSING
}

export function channelFlowCompletion(record) {
  const items = (Array.isArray(record?.items) ? record.items : [])
    .filter((item) => String(item?.gameName || item?.game_name || '').trim())
  const rows = items.map((item) => ({ ...item, flowInputState: resolveChannelFlowInputState(item) }))
  const missing = rows.filter((item) => item.flowInputState === CHANNEL_FLOW_INPUT_STATE.MISSING)
  const confirmedZero = rows.filter((item) => item.flowInputState === CHANNEL_FLOW_INPUT_STATE.CONFIRMED_ZERO)
  const entered = rows.filter((item) => item.flowInputState === CHANNEL_FLOW_INPUT_STATE.ENTERED)
  return {
    total: rows.length,
    missingCount: missing.length,
    confirmedZeroCount: confirmedZero.length,
    enteredCount: entered.length,
    complete: rows.length > 0 && missing.length === 0,
    missingGames: missing.map((item) => String(item.gameName || item.game_name || '').trim()).filter(Boolean)
  }
}

const HEADER_ALIASES = Object.freeze({
  gameName: ['游戏', '游戏名', '游戏名称', '产品', '产品名', '产品名称'],
  flow: ['后台流水', '流水', '计费流水', '充值', '充值金额', '后台充值', '总流水'],
  voucherCost: ['代金券', '券成本', '代金券成本'],
  refundCost: ['退款', '玩家退款', '退款成本'],
  testCost: ['测试费', '测试成本'],
  platformSettlementAmount: ['平台结算', '平台结算金额', '渠道应收', '结算金额']
})

const FIXED_COLUMNS = ['gameName', 'flow', 'voucherCost', 'refundCost', 'testCost', 'platformSettlementAmount']

function cleanCell(value) {
  return String(value ?? '').trim()
}

function parseNumberCell(value) {
  const raw = cleanCell(value)
  if (!raw) return { present: false, value: '' }
  const normalized = raw.replace(/[,，￥¥\s]/g, '')
  const number = Number(normalized)
  if (!Number.isFinite(number)) return { present: false, value: '', invalid: true, raw }
  return { present: true, value: String(number), number }
}

function headerKey(value) {
  return normalizeChannelTextKey(value).replace(/[：:]/g, '')
}

function detectHeader(cells) {
  const lookup = new Map()
  Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
    aliases.forEach((alias) => lookup.set(headerKey(alias), field))
  })
  const mapped = cells.map((cell) => lookup.get(headerKey(cell)) || '')
  const hits = mapped.filter(Boolean).length
  return hits >= 2 ? mapped : null
}

export function parseChannelFlowPaste(text) {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())

  if (!lines.length) return { rows: [], warnings: [], hasHeader: false }

  const matrix = lines.map((line) => line.split('\t'))
  const detected = detectHeader(matrix[0])
  const fields = detected || FIXED_COLUMNS
  const dataRows = detected ? matrix.slice(1) : matrix
  const warnings = []
  const rows = []

  dataRows.forEach((cells, index) => {
    const sourceLine = index + (detected ? 2 : 1)
    const candidate = {}
    fields.forEach((field, columnIndex) => {
      if (!field) return
      const cell = cells[columnIndex]
      if (field === 'gameName') {
        const value = cleanCell(cell)
        if (value) candidate.gameName = value
        return
      }
      const parsed = parseNumberCell(cell)
      if (parsed.invalid) warnings.push(`第 ${sourceLine} 行“${parsed.raw}”不是有效金额，已跳过该单元格。`)
      if (parsed.present) candidate[field] = parsed.value
    })
    if (!candidate.gameName) {
      if (Object.keys(candidate).length) warnings.push(`第 ${sourceLine} 行缺少游戏名称，已跳过。`)
      return
    }
    rows.push(candidate)
  })

  return { rows, warnings, hasHeader: Boolean(detected) }
}

export function applyChannelFlowPaste(record, pastedRows, createBlankLine) {
  const currentItems = Array.isArray(record?.items) ? record.items : []
  const items = currentItems.map((item) => ({ ...item }))
  const indexByGame = new Map()
  items.forEach((item, index) => {
    const key = normalizeChannelTextKey(item?.gameName)
    if (key && !indexByGame.has(key)) indexByGame.set(key, index)
  })

  let matched = 0
  let added = 0
  const updatedGames = []

  for (const source of pastedRows || []) {
    const gameName = String(source?.gameName || '').trim()
    if (!gameName) continue
    const key = normalizeChannelTextKey(gameName)
    let index = indexByGame.get(key)
    if (index == null) {
      const base = typeof createBlankLine === 'function' ? createBlankLine(gameName) : { gameName }
      items.push({ ...base, gameName })
      index = items.length - 1
      indexByGame.set(key, index)
      added += 1
    } else {
      matched += 1
    }

    const next = { ...items[index] }
    for (const field of FIXED_COLUMNS) {
      if (field === 'gameName' || source[field] === undefined) continue
      next[field] = source[field]
    }
    if (source.flow !== undefined) {
      next.flowInputState = Number(source.flow) === 0
        ? CHANNEL_FLOW_INPUT_STATE.CONFIRMED_ZERO
        : CHANNEL_FLOW_INPUT_STATE.ENTERED
    }
    items[index] = next
    updatedGames.push(gameName)
  }

  return {
    record: { ...(record || {}), items },
    matched,
    added,
    updatedGames
  }
}
