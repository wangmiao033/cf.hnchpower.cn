export function invoiceMatchScore(scoreById, rawId) {
  const id = String(rawId || '')
  const score = Number(scoreById?.[id] || 0)
  return Number.isFinite(score) ? score : 0
}

export function sortInvoicesByMatchScore(rows = [], scoreById = {}, getId = (item) => item?.id) {
  return rows
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const rightScore = invoiceMatchScore(scoreById, getId(right.item))
      const leftScore = invoiceMatchScore(scoreById, getId(left.item))
      if (Math.abs(rightScore - leftScore) > 0.000001) return rightScore - leftScore

      const rightDate = String(right.item?.issueDate || right.item?.invoiceDate || right.item?.date || '')
      const leftDate = String(left.item?.issueDate || left.item?.invoiceDate || left.item?.date || '')
      const dateCompare = rightDate.localeCompare(leftDate)
      if (dateCompare !== 0) return dateCompare

      return left.index - right.index
    })
    .map(({ item }) => item)
}
