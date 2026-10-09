/**
 * Read complete paginated financial ledgers. A first-page-only list must never be
 * silently presented as the full payable balance or payroll amount.
 */
export async function fetchEveryLedgerPage(fetchPage, { pageSize = 500, maxPages = 200 } = {}) {
  const first = await fetchPage({ limit: pageSize, offset: 0 })
  const initial = Array.isArray(first?.items) ? first.items : []
  const total = Number(first?.total)
  if (!Number.isInteger(total) || total < 0 || initial.length > total) {
    throw new Error('财务台账分页数据异常，请刷新后重试')
  }
  const items = [...initial]
  const ids = new Set(items.map((item) => item?.id).filter(Boolean))
  let pages = 1
  while (items.length < total) {
    if (pages >= maxPages) {
      throw new Error('财务记录数量超过安全读取上限，请缩小月份范围后重试')
    }
    const next = await fetchPage({ limit: pageSize, offset: items.length })
    pages += 1
    const rows = next?.items
    if (!Array.isArray(rows) || !rows.length || Number(next.total) !== total) {
      throw new Error('读取过程中台账数据发生变化，请刷新后重试以确保金额准确')
    }
    for (const item of rows) {
      if (item?.id && ids.has(item.id)) {
        throw new Error('读取过程中发现重复财务记录，请刷新后重试')
      }
      if (item?.id) ids.add(item.id)
      items.push(item)
    }
    if (items.length > total) {
      throw new Error('财务台账分页记录数不一致，请刷新后重试')
    }
  }
  return { ...first, items }
}
