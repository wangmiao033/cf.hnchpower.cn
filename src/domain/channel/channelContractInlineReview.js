
/**
 * Compare the actual commercial SKU, not just its base game title.
 * 005折 / 0.05折 and optional brackets are formatting aliases only.
 * 红包版, 普通版 and different discounts remain different financial products.
 */
export function comparableCommercialGameName(value) {
  const raw = String(value ?? '').normalize('NFKC').trim().toLowerCase()
    .replace(/[()\[\]【】\s]/g, '')
  return raw.replace(/(?<!\d)\d+(?:\.\d+)?折/g, (token) => {
    const numberToken = token.slice(0, -1)
    const canonical = /^0\d{1,4}$/.test(numberToken)
      ? Number('0.' + numberToken.slice(1))
      : Number(numberToken)
    return Number.isFinite(canonical) ? String(canonical) + '折' : token
  })
}

export function sameCommercialGameName(left, right) {
  const a = comparableCommercialGameName(left)
  return Boolean(a && a === comparableCommercialGameName(right))
}

/**
 * Contract access items use a REPLACE-style PUT endpoint (not PATCH).
 * Copying only product_name/share_rate dates deletes every other field.
 * Always emit the complete contract row and overlay only explicitly reviewed data.
 */
export const CONTRACT_ACCESS_FIELDS = Object.freeze([
  'channel_name', 'agreement_type', 'platform_record_id', 'product_name',
  'app_id', 'platform', 'language', 'category', 'rights_source',
  'game_status', 'agreement_status', 'authorization_start', 'authorization_end',
  'share_rate', 'channel_fee_rate', 'software_copyright_no', 'isbn',
  'territory', 'status', 'remarks'
])

export function fullContractAccessUpdate(row, changes = {}) {
  if (!row || !row.id || !row.contract_id) {
    throw new Error('缺少当前合同合作项标识，不能安全更新')
  }
  const missing = CONTRACT_ACCESS_FIELDS.filter(field => !Object.prototype.hasOwnProperty.call(row, field))
  if (missing.length) {
    throw new Error('合作项资料不完整，暂不能覆盖服务器合同：' + missing.join('、'))
  }
  for (const key of Object.keys(changes)) {
    if (!CONTRACT_ACCESS_FIELDS.includes(key)) {
      throw new Error('本页不允许修改未知合同字段：' + key)
    }
  }
  const result = Object.fromEntries(CONTRACT_ACCESS_FIELDS.map(field => [field, changes[field] !== undefined ? changes[field] : row[field]]))
  if (!String(result.product_name || '').trim()) throw new Error('合同游戏名称不能为空')
  return result
}

export function cleanContractDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(raw + 'T00:00:00Z').getTime())
    || new Date(raw + 'T00:00:00Z').toISOString().slice(0, 10) !== raw) {
    throw new Error('授权日期必须是有效的 YYYY-MM-DD 日期')
  }
  return raw
}

export function checkContractAuthorizationForMonth(month, from, to) {
  const start = cleanContractDate(from)
  const end = cleanContractDate(to)
  if (start && end && start > end) throw new Error('授权开始不能晚于结束日期')
  const m = /^20\d{2}-(?:0[1-9]|1[0-2])$/.test(String(month || '')) ? month : ''
  if (m) {
    const year = Number(m.slice(0, 4)), mth = Number(m.slice(5, 7))
    const monthStart = m + '-01'
    const monthEnd = m + '-' + String(new Date(Date.UTC(year, mth, 0)).getUTCDate()).padStart(2, '0')
    if ((start && start > monthEnd) || (end && end < monthStart)) {
      throw new Error('填写的授权期不包含当前账期 ' + m + '，请核实合同原件')
    }
  }
  return { authorization_start: start, authorization_end: end }
}

export function candidateKey(contract, item) {
  return String(contract?.id || '') + '::' + String(item?.id || '')
}

export function accessDataModified(row, data) {
  return ['product_name', 'channel_name', 'authorization_start', 'authorization_end']
    .some(k => String(row?.[k] || '').trim() !== String(data?.[k] || '').trim())
}

export function withContractReviewNote(row, note, month) {
  const previous = String(row?.remarks || '').trim()
  const reason = String(note || '').trim()
  if (reason.length < 6) throw new Error('请填写至少6个字的合同核对依据')
  const addition = '【账单页合同核对·' + String(month || '未指定账期') + '】' + reason
  if (previous.includes(addition)) return previous
  const result = [previous, addition].filter(Boolean).join('\n')
  if (result.length > 1950) throw new Error('合作项原备注过长，不能安全追加核对记录')
  return result
}
