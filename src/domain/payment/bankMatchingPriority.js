const CONFIDENCE_PRIORITY = Object.freeze({ high: 0, medium: 1, low: 2, none: 3 })

export function bankMatchScore(item) {
  const score = Number(item?.top_score ?? item?.candidates?.[0]?.score ?? 0)
  return Number.isFinite(score) ? score : 0
}

export function filterBankMatchRows(rows = [], filter = 'all') {
  if (filter === 'excellent') return rows.filter((item) => bankMatchScore(item) >= 90)
  if (filter === 'high') return rows.filter((item) => {
    const score = bankMatchScore(item)
    return score >= 80 && score < 90
  })
  if (filter === 'review') return rows.filter((item) => {
    const score = bankMatchScore(item)
    return score >= 60 && score < 80
  })
  if (filter === 'unmatched') return rows.filter((item) => bankMatchScore(item) < 60)
  return rows
}

export function sortBankMatchRows(rows = [], sortMode = 'match') {
  const sorted = [...rows]
  sorted.sort((left, right) => {
    if (sortMode === 'date') {
      const dateCompare = String(right?.trade_date || '').localeCompare(String(left?.trade_date || ''))
      if (dateCompare !== 0) return dateCompare
      return bankMatchScore(right) - bankMatchScore(left)
    }

    if (sortMode === 'amount') {
      const amountCompare = Number(right?.amount || 0) - Number(left?.amount || 0)
      if (Math.abs(amountCompare) > 0.005) return amountCompare
      return bankMatchScore(right) - bankMatchScore(left)
    }

    const confidenceCompare = (CONFIDENCE_PRIORITY[left?.confidence_level] ?? 4) - (CONFIDENCE_PRIORITY[right?.confidence_level] ?? 4)
    if (confidenceCompare !== 0) return confidenceCompare

    const scoreCompare = bankMatchScore(right) - bankMatchScore(left)
    if (Math.abs(scoreCompare) > 0.005) return scoreCompare

    const marginCompare = Number(right?.ambiguity_margin || 0) - Number(left?.ambiguity_margin || 0)
    if (Math.abs(marginCompare) > 0.005) return marginCompare

    const autoCompare = Number(Boolean(right?.auto_ready)) - Number(Boolean(left?.auto_ready))
    if (autoCompare !== 0) return autoCompare

    return String(right?.trade_date || '').localeCompare(String(left?.trade_date || ''))
  })
  return sorted
}
