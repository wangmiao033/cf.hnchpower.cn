function monthParts(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/(20\d{2})\D{0,3}(1[0-2]|0?[1-9])(?:\D|$)/)
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]) }
}

function addMonths(year, month, offset) {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function isoDate(year, month, day) {
  const safeDay = Math.max(1, Math.min(daysInMonth(year, month), Number(day || 1)))
  return `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  date.setUTCDate(date.getUTCDate() + Number(days || 0))
  return date.toISOString().slice(0, 10)
}

export function dueDateFromPaymentTerms(settlementCycle, paymentTerms) {
  const parts = monthParts(settlementCycle)
  const terms = String(paymentTerms || '').trim()
  if (!parts || !terms) return null

  const normalized = terms
    .replace(/\s+/g, '')
    .replace(/号/g, '日')
    .replace(/之前|以前/g, '前')

  const monthDay = normalized.match(/(次次月|隔月|次月|当月|本月)(\d{1,2})日前?/)
  if (monthDay) {
    const offset = monthDay[1] === '次月' ? 1 : (monthDay[1] === '次次月' || monthDay[1] === '隔月') ? 2 : 0
    const target = addMonths(parts.year, parts.month, offset)
    return isoDate(target.year, target.month, Number(monthDay[2]))
  }

  const monthEnd = normalized.match(/(次次月|隔月|次月|当月|本月)(?:底|末|月底|月末)/)
  if (monthEnd) {
    const offset = monthEnd[1] === '次月' ? 1 : (monthEnd[1] === '次次月' || monthEnd[1] === '隔月') ? 2 : 0
    const target = addMonths(parts.year, parts.month, offset)
    return isoDate(target.year, target.month, daysInMonth(target.year, target.month))
  }

  const dayTerms = normalized.match(/(?:月结|结算后|对账后|账期)(\d{1,3})(?:天|日)/)
  if (dayTerms) {
    const monthEndIso = isoDate(parts.year, parts.month, daysInMonth(parts.year, parts.month))
    return addDays(monthEndIso, Number(dayTerms[1]))
  }

  const tPlus = normalized.match(/T\+(\d{1,3})/i)
  if (tPlus) {
    const monthEndIso = isoDate(parts.year, parts.month, daysInMonth(parts.year, parts.month))
    return addDays(monthEndIso, Number(tPlus[1]))
  }

  return null
}

function localDay(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayDiff(left, right) {
  const leftDate = new Date(`${left}T00:00:00Z`)
  const rightDate = new Date(`${right}T00:00:00Z`)
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) return 0
  return Math.round((leftDate.getTime() - rightDate.getTime()) / 86400000)
}

export function billDueInfo(contractReconciliation, now = new Date()) {
  const rows = (contractReconciliation?.lines || [])
    .map((line) => {
      const paymentTerms = String(line?.match?.payment_terms || '').trim()
      const dueDate = dueDateFromPaymentTerms(line?.settlement_cycle, paymentTerms)
      return dueDate ? { dueDate, paymentTerms, settlementCycle: line?.settlement_cycle || '' } : null
    })
    .filter(Boolean)

  if (!rows.length) return null

  rows.sort((left, right) => left.dueDate.localeCompare(right.dueDate))
  const earliest = rows[0]
  const today = localDay(now)
  const daysFromDue = dayDiff(today, earliest.dueDate)
  const terms = [...new Set(rows.map((row) => row.paymentTerms).filter(Boolean))]

  return {
    dueDate: earliest.dueDate,
    paymentTerms: terms.join(' / '),
    overdueDays: Math.max(0, daysFromDue),
    daysUntil: Math.max(0, -daysFromDue),
    isPastDue: daysFromDue > 0,
    isDueToday: daysFromDue === 0,
    source: '合同账期'
  }
}

export function dueStatusText(dueInfo, { settled = false, remainingKnown = true } = {}) {
  if (!dueInfo) return ''
  if (settled) return '已结清'
  if (dueInfo.isPastDue) return remainingKnown ? `逾期 ${dueInfo.overdueDays} 天` : `已到期 ${dueInfo.overdueDays} 天`
  if (dueInfo.isDueToday) return '今日到期'
  return `距到期 ${dueInfo.daysUntil} 天`
}
