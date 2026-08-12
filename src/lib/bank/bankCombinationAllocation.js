const COMPANY_SUFFIXES = [
  '有限责任公司',
  '股份有限公司',
  '有限公司',
  '责任公司',
  '公司',
  'pte.ltd',
  'pte ltd',
  'limited',
  'ltd',
  'inc'
]

const MAX_CANDIDATES_PER_PARTNER = 18
const MAX_BILLS_PER_COMBINATION = 6
const MAX_EXACT_COMBINATIONS = 6

function numberValue(value) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function cents(value) {
  return Math.round(numberValue(value) * 100)
}

export function normalizeBankAllocationParty(value) {
  let text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-—_·,，.。()（）[\]【】/\\]/g, '')

  for (const suffix of COMPANY_SUFFIXES) {
    const normalizedSuffix = suffix.toLowerCase().replace(/[\s.]/g, '')
    if (text.endsWith(normalizedSuffix) && text.length > normalizedSuffix.length + 1) {
      text = text.slice(0, -normalizedSuffix.length)
      break
    }
  }
  return text
}

function partyMatchStrength(counterparty, partner) {
  const left = normalizeBankAllocationParty(counterparty)
  const right = normalizeBankAllocationParty(partner)
  if (!left || !right) return 0
  if (left === right) return 2
  if (left.includes(right) || right.includes(left)) return 1
  return 0
}

function candidateKey(candidate) {
  return `${candidate?.bill_type || ''}:${candidate?.bill_id || ''}`
}

function monthRank(value) {
  const matched = String(value || '').match(/(20\d{2})[-/.年](\d{1,2})/)
  if (!matched) return 0
  return Number(matched[1]) * 12 + Number(matched[2])
}

function sortCombinationItems(items) {
  return [...items].sort((a, b) => {
    const monthDiff = monthRank(a.settlement_month) - monthRank(b.settlement_month)
    if (monthDiff !== 0) return monthDiff
    return String(a.bill_number || a.bill_id || '').localeCompare(String(b.bill_number || b.bill_id || ''), 'zh-CN')
  })
}

function exactCombinations(candidates, targetCents) {
  const prepared = candidates
    .filter((candidate) => cents(candidate?.outstanding_amount) > 0)
    .map((candidate) => ({ candidate, amountCents: cents(candidate.outstanding_amount) }))
    .filter((item) => item.amountCents <= targetCents)
    .slice(0, MAX_CANDIDATES_PER_PARTNER)

  const found = []
  const chosen = []

  const walk = (start, remaining) => {
    if (found.length >= MAX_EXACT_COMBINATIONS) return
    if (remaining === 0) {
      if (chosen.length >= 2) found.push(chosen.map((item) => item.candidate))
      return
    }
    if (chosen.length >= MAX_BILLS_PER_COMBINATION) return

    for (let index = start; index < prepared.length; index += 1) {
      const item = prepared[index]
      if (item.amountCents > remaining) continue
      chosen.push(item)
      walk(index + 1, remaining - item.amountCents)
      chosen.pop()
      if (found.length >= MAX_EXACT_COMBINATIONS) return
    }
  }

  walk(0, targetCents)
  return found
}

export function buildExactBillCombination(item) {
  const remainingCents = cents(item?.remaining_amount ?? item?.amount)
  if (remainingCents <= 0) return null

  const expectedBillType = item?.direction === 'collection'
    ? 'channel'
    : item?.direction === 'payment'
      ? 'rd'
      : null
  if (!expectedBillType) return null

  const seen = new Set()
  const groups = new Map()
  for (const candidate of item?.candidates || []) {
    if (candidate?.bill_type !== expectedBillType) continue
    if (!candidate?.bill_id || cents(candidate?.outstanding_amount) <= 0) continue
    const key = candidateKey(candidate)
    if (seen.has(key)) continue
    seen.add(key)

    const partnerKey = normalizeBankAllocationParty(candidate.partner_name)
    if (!partnerKey) continue
    if (!groups.has(partnerKey)) groups.set(partnerKey, [])
    groups.get(partnerKey).push(candidate)
  }

  const exact = []
  for (const candidates of groups.values()) {
    if (candidates.length < 2) continue
    const sorted = [...candidates].sort((a, b) => {
      const partyDiff = partyMatchStrength(item?.counterparty_name, b?.partner_name)
        - partyMatchStrength(item?.counterparty_name, a?.partner_name)
      if (partyDiff !== 0) return partyDiff
      const scoreDiff = numberValue(b?.score) - numberValue(a?.score)
      if (scoreDiff !== 0) return scoreDiff
      return cents(b?.outstanding_amount) - cents(a?.outstanding_amount)
    })
    for (const members of exactCombinations(sorted, remainingCents)) {
      exact.push({
        members: sortCombinationItems(members),
        partyStrength: partyMatchStrength(item?.counterparty_name, members[0]?.partner_name)
      })
      if (exact.length >= MAX_EXACT_COMBINATIONS) break
    }
    if (exact.length >= MAX_EXACT_COMBINATIONS) break
  }

  if (!exact.length) return null

  exact.sort((a, b) => {
    if (b.partyStrength !== a.partyStrength) return b.partyStrength - a.partyStrength
    if (a.members.length !== b.members.length) return a.members.length - b.members.length
    const aScore = a.members.reduce((sum, candidate) => sum + numberValue(candidate?.score), 0)
    const bScore = b.members.reduce((sum, candidate) => sum + numberValue(candidate?.score), 0)
    return bScore - aScore
  })

  const best = exact[0]
  const sameRankCount = exact.filter((combo) => (
    combo.partyStrength === best.partyStrength && combo.members.length === best.members.length
  )).length
  const ambiguous = sameRankCount > 1
  const partnerName = String(best.members[0]?.partner_name || '').trim()

  let score = 65
  const reasons = ['多张账单未结金额之和与银行流水剩余金额完全一致', '组合内账单属于同一合作方']
  if (best.partyStrength === 2) {
    score += 25
    reasons.push('银行对方户名与账单合作方一致')
  } else if (best.partyStrength === 1) {
    score += 18
    reasons.push('银行对方户名与账单合作方高度相似')
  } else {
    reasons.push('银行对方户名未形成强匹配，提交前请人工确认合作方')
  }
  if (best.members.length <= 4) score += 5
  if (!ambiguous) {
    score += 5
    reasons.push('当前候选中只有一个最优精确组合')
  } else {
    score = Math.min(score, 79)
    reasons.push('存在多个同等级精确组合，需人工确认')
  }
  score = Math.min(100, score)

  const confidenceLevel = score >= 90 && !ambiguous
    ? 'high'
    : score >= 70
      ? 'medium'
      : 'low'

  return {
    exact: true,
    ambiguous,
    autoReady: confidenceLevel === 'high' && !ambiguous,
    confidenceLevel,
    score,
    partnerName,
    totalAmount: remainingCents / 100,
    count: best.members.length,
    reasons,
    items: best.members.map((candidate) => ({
      candidate,
      candidateKey: candidateKey(candidate),
      amount: cents(candidate.outstanding_amount) / 100
    }))
  }
}
