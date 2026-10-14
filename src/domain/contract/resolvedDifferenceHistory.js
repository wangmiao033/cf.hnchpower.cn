/**
 * Collapse only identical, resolved *accepted* finance exceptions in the view.
 *
 * A regenerated line ID after editing a bill can create another exception case
 * for the same bill, game, contract and amount. Removing cases from the DB
 * would destroy the approval evidence used by financial reconciliation.
 * Never merge pending, processing, adjustment or carry-forward cases.
 */
const text = (value) => String(value ?? '').trim()
const amount = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(2) : null
}

export function resolvedDifferenceKey(item) {
  if (item?.status !== 'resolved' || item?.handling_type !== 'accept_difference') return null
  if (!item.id || !item.bill_id || !item.bill_type || !item.game_name || !item.settlement_cycle) return null
  const contract = [text(item.contract_id), text(item.access_item_id), text(item.contract_no)]
  // Do not fold two independent unbound contracts just because amounts match.
  if (!contract.some(Boolean)) return null
  const numbers = [item.expected_amount, item.actual_amount, item.difference_amount].map(amount)
  if (numbers.some((n) => n === null)) return null
  return JSON.stringify([
    text(item.bill_type), text(item.bill_id), text(item.statement_no),
    text(item.game_name), text(item.settlement_cycle),
    ...contract, ...numbers, text(item.variance_direction)
  ])
}

function timestamp(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

export function groupResolvedDifferenceHistory(items = []) {
  const byKey = new Map()
  const groups = []
  for (const item of items || []) {
    const key = resolvedDifferenceKey(item)
    if (key && byKey.has(key)) {
      byKey.get(key).push(item)
    } else {
      const group = [item]
      groups.push(group)
      if (key) byKey.set(key, group)
    }
  }
  const hiddenIds = new Set()
  const visibleItems = groups.map((group) => {
    if (group.length === 1) return group[0]
    // The latest recorded case is usually the one tied to the current bill
    // line. Never mutate or auto-approve cases during this display operation.
    const newest = group.slice().sort((left, right) =>
      timestamp(right.created_at) - timestamp(left.created_at)
      || timestamp(right.resolved_at) - timestamp(left.resolved_at)
      || text(right.id).localeCompare(text(left.id))
    )[0]
    for (const item of group) {
      if (item !== newest) hiddenIds.add(text(item.id))
    }
    return newest
  })
  return { visibleItems, hiddenIds, hiddenCount: hiddenIds.size }
}
