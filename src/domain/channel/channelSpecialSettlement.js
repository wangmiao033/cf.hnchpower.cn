/**
 * Direct, auditable contract-difference confirmation for a saved CHANNEL bill.
 *
 * Finance must explicitly approve the current numbers. This helper never
 * changes settlement values or contract rules and refuses stale/foreign cases.
 */
const EDITABLE_STATUSES = new Set(['draft', 'pending'])
const ALLOWED_HANDLINGS = new Set(['', 'edit_bill'])
const SPECIAL_REASON = '商务特殊约定'
const FILE_DESCRIPTION = '本期渠道分成结算确认函（请在账单附件归档原件或盖章版本）'

function numeric(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function numberText(value) {
  const n = numeric(value)
  return n === null ? '-' : n.toFixed(2)
}

export function prepareChannelSpecialSettlement({ billId, record, cases }) {
  const id = String(billId || '')
  if (!id || !record || String(record.id || '') !== id) {
    return { error: '账单数据已过期，请重新打开账单后再确认', actions: [] }
  }
  if (!EDITABLE_STATUSES.has(String(record.status || '').trim().toLowerCase())) {
    return { error: '这张账单状态已更新，不能重复进行特殊结算确认', actions: [] }
  }

  if (!Array.isArray(cases) || cases.length === 0) {
    return { error: '还没有生成可处理的合同差异，请先点击“保存并确认核对”重新检测', actions: [] }
  }
  if (cases.length > 30) {
    return { error: '当前合同差异过多，请到合同差异工作台逐项核对', actions: [] }
  }
  if (cases.some(item => String(item.bill_id) !== id || item.bill_type !== 'channel')) {
    return { error: '读取到其他账单的差异，已停止操作以避免误确认', actions: [] }
  }
  if (cases.some(item => item.status === 'resolved' && item.handling_type !== 'accept_difference')) {
    return { error: '账单存在已按补差或其他流程处理的差异，请到合同差异工作台核对', actions: [] }
  }

  const pending = cases.filter(item => item.status !== 'resolved')
  if (pending.some(item => !ALLOWED_HANDLINGS.has(String(item.handling_type || '')))) {
    return { error: '差异已进入其他处理流程，为避免覆盖原有处理决定，请到合同差异工作台继续', actions: [] }
  }

  const lines = Array.isArray(record.items) ? record.items : []
  const actions = []
  for (const item of pending) {
    const line = lines.find(row => String(row.id || '') === String(item.line_id || '')) ||
      lines.find(row =>
        String(row.gameName || '').trim() === String(item.game_name || '').trim() &&
        String(row.settlementCycle || '').trim() === String(item.settlement_cycle || '').trim()
      )

    if (!line) {
      return { error: '已保存的游戏明细和合同差异无法对应，请刷新账单后重新核对', actions: [] }
    }
    const recordedAmount = numeric(line.settlementAmount)
    const caseAmount = numeric(item.actual_amount)
    if (recordedAmount === null || caseAmount === null || Math.abs(recordedAmount - caseAmount) > 0.021) {
      return { error: '合同差异引用的金额与服务器账单不一致，不能直接确认；请重新核对最新数据', actions: [] }
    }

    const share = numeric(line.shareRate)
    const fee = numeric(line.channelFeeRate ?? record.channelFeeRate)
    const terms = [
      share === null ? null : '分成比例 ' + share + '%',
      fee === null ? null : '通道费率 ' + fee + '%',
    ].filter(Boolean).join('、')

    const label = (item.game_name || line.gameName || '游戏') + '（' +
      (item.settlement_cycle || line.settlementCycle || '本期') + '）'

    actions.push({
      caseId: String(item.id),
      label,
      description: '本期按照渠道提供的分成结算确认函作特殊结算确认：' +
        label + '，' + (terms || '沿用本期账单已保存的结算规则') +
        '，账单实际结算 ¥' + numberText(recordedAmount) + '。' +
        '与合同理论口径存在差异；财务已主动确认保留本期账单实际金额，合同原值、账单明细和回款数据均不修改。',
      reasonType: SPECIAL_REASON,
      evidence: [FILE_DESCRIPTION]
    })
  }

  return {
    error: '',
    actions,
    total: cases.length,
    billAmount: numberText(record.settlementAmount),
    summary: actions.map(item => item.label).join('、')
  }
}
