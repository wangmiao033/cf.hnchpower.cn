import { calculateRdSettlementRow } from '@/domain/settlement/calculateSettlementAmount.js'

const BASIS_MODES = new Set(['actual_paid', 'discounted_flow'])
export function finiteAmount(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

// A presentation model only: never applies recommended fields or changes saved amounts.
export function buildRdContractReview(record, recommendation, { current = true, loading = false, error = '' } = {}) {
  const rows = (record?.items || []).map((line, index) => ({ line, index })).filter(({ line }) => String(line?.gameName || '').trim())
  const available = current && !loading && !error && Boolean(recommendation)
  const lines = rows.map(({ line, index }) => {
    const item = recommendation?.lines?.find((candidate) => candidate.line_index === index)
    const rec = item?.recommended
    const reasons = []
    if (!available) reasons.push(error ? '合同服务暂不可用' : '等待本轮合同匹配完成')
    if (!item?.match) reasons.push('尚未匹配合同')
    else if (item.match.authorization_status !== 'covered') reasons.push(item.match.authorization_status === 'out_of_range' ? '账期不在合同授权期内' : '合同授权期待确认')
    if (item?.match && item.auto_apply !== true) reasons.push('合同匹配仍需人工复核')
    if (!BASIS_MODES.has(rec?.basis_mode)) reasons.push(`结算基数与折扣口径待确认；账单当前系数 ${line.discountRate ?? 1}`)
    if (item?.contract_amount?.deterministic !== true) reasons.push('合同条款尚不足以确定应结金额')
    const expected = finiteAmount(item?.contract_amount?.expected_amount)
    if (expected === null) reasons.push('暂无可用的合同试算金额')
    if (recommendation?.header_recommendation?.compatible === false) reasons.push('整单合同通道费率不一致')
    const comparisons = [
      ['discount', '折扣系数', line.discountRate ?? 1, BASIS_MODES.has(rec?.basis_mode) ? rec.settlement_discount_rate : null],
      ['share', '分成比例', line.shareRatio ?? 0, rec?.share_ratio, '%'],
      ['tax', '税率', line.taxRate ?? 0, rec?.tax_rate, '%'],
      ['channel', '通道费率', record?.channelFeeRate ?? 0, rec?.channel_fee_rate, '%'],
      ['test', '测试费', line.testFee ?? 0, rec?.test_fee, '元']
    ].filter(([, , actual, recommended]) => finiteAmount(recommended) !== null && finiteAmount(actual) !== null && Math.abs(Number(actual) - Number(recommended)) > 0.000001)
      .map(([key, label, actual, recommended, unit = '']) => ({ key, label, actual: Number(actual), recommended: Number(recommended), unit }))
    const calculation = calculateRdSettlementRow(line, record?.channelFeeRate)
    const comparable = reasons.length === 0
    return { index, line, item, calculation, comparable, expected, reasons: [...new Set(reasons)], comparisons,
      difference: comparable ? Math.round((calculation.settlementAmount - expected) * 100) / 100 : null }
  })
  const comparable = lines.length > 0 && lines.every((line) => line.comparable)
  const expected = comparable ? Math.round(lines.reduce((sum, line) => sum + line.expected, 0) * 100) / 100 : null
  const actual = finiteAmount(record?.settlementAmount)
  return { lines, comparable, expected, actual, pendingCount: lines.filter((line) => !line.comparable).length,
    difference: comparable && actual !== null ? Math.round((actual - expected) * 100) / 100 : null }
}

export function hasRdAdditionalFees(line, channelFeeRate) {
  return [line?.testFee, line?.extraFee, line?.taxRate, channelFeeRate].some((value) => {
    const amount = finiteAmount(value)
    return amount !== null && amount !== 0
  })
}
