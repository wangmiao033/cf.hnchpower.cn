export function roundMoney(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.round(number * 100) / 100
}

export function resolveRdPrepaymentPreview({
  settlement,
  contractDeduction = 0,
  statementAmount = null,
  contractAvailable = null
} = {}) {
  const gross = roundMoney(Math.max(0, Number(settlement) || 0))
  const contract = roundMoney(Math.min(gross, Math.max(0, Number(contractDeduction) || 0)))
  const hasStatement = statementAmount !== null && statementAmount !== undefined && String(statementAmount).trim() !== ''
  const requested = hasStatement ? roundMoney(Math.max(0, Number(statementAmount) || 0)) : null
  let deduction = hasStatement ? roundMoney(Math.min(gross, requested)) : contract
  const pool = contractAvailable === null || contractAvailable === undefined
    ? null
    : roundMoney(Math.max(0, Number(contractAvailable) || 0))
  let poolCapped = false
  if (hasStatement && pool !== null && pool > 0 && deduction > pool) {
    deduction = pool
    poolCapped = true
  }
  return {
    settlement: gross,
    deduction,
    actualPayable: roundMoney(Math.max(0, gross - deduction)),
    source: hasStatement ? 'statement' : (contract > 0 ? 'contract' : 'none'),
    capped: Boolean(hasStatement && requested > gross),
    poolCapped
  }
}

export function allocateStatementPrepayment(settlements, amount) {
  let remaining = roundMoney(Math.max(0, Number(amount) || 0))
  return (Array.isArray(settlements) ? settlements : []).map((settlement) => {
    const cap = roundMoney(Math.max(0, Number(settlement) || 0))
    const applied = roundMoney(Math.min(cap, remaining))
    remaining = roundMoney(Math.max(0, remaining - applied))
    return applied
  })
}

export function contractPrepaymentAvailable(prepaymentByLine) {
  const groups = new Map()
  Object.entries(prepaymentByLine || {}).forEach(([index, item]) => {
    if (!item?.enabled) return
    const key = String(item.accessItemId || `line:${index}`)
    const available = roundMoney(Math.max(0, Number(item.availableBefore) || 0))
    groups.set(key, Math.max(groups.get(key) || 0, available))
  })
  return roundMoney([...groups.values()].reduce((sum, value) => sum + value, 0))
}

export function describeRdPrepaymentHint(preview, { contractAvailable = 0 } = {}) {
  const available = roundMoney(Math.max(0, Number(contractAvailable) || 0))
  const deduction = roundMoney(preview?.deduction)
  const settlement = roundMoney(preview?.settlement)
  const payable = roundMoney(preview?.actualPayable)
  if (preview?.poolCapped) {
    return `对账单预付款余额高于合同还可抵扣的 ¥${available.toFixed(2)}，本期先按可用余额抵扣，实际应付 ¥${payable.toFixed(2)}。`
  }
  if (preview?.source === 'statement' && deduction > 0) {
    return `已按对账单预付款余额抵扣 ¥${deduction.toFixed(2)}，研发应结仍是 ¥${settlement.toFixed(2)}，实际应付 ¥${payable.toFixed(2)}。`
  }
  if (preview?.source === 'contract') {
    return `合同预付款还可抵扣 ¥${available.toFixed(2)}，本期先抵扣 ¥${deduction.toFixed(2)}。若对账单上的预付款余额不同，直接改这个金额。`
  }
  if (available > 0) {
    return `合同预付款还可抵扣 ¥${available.toFixed(2)}，本期研发应结还没有使用。`
  }
  return '合同合作清单里目前没有可用预付款。对账单上的「预付款余额」填在这里后，会从本期应付中扣除，研发应结不变。'
}
