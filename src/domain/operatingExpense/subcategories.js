/** Other operating expenses remain in their original accounting category. */
export const OTHER_EXPENSE_SUBCATEGORIES = Object.freeze([
  {
    "value": "courier_logistics",
    "label": "快递物流费"
  },
  {
    "value": "office_supplies",
    "label": "办公用品费"
  },
  {
    "value": "travel_transport",
    "label": "交通差旅费"
  },
  {
    "value": "business_entertainment",
    "label": "业务招待费"
  },
  {
    "value": "miscellaneous",
    "label": "其他杂费"
  }
])

export const LEGACY_SUBCATEGORY_VALUE = 'unclassified'

export function expenseSubcategoryLabel(value) {
  return OTHER_EXPENSE_SUBCATEGORIES.find((item) => item.value === value)?.label || '未分类（历史记录）'
}

export function filterOtherExpenses(rows, selected) {
  if (!selected || selected === 'all') return rows
  return rows.filter((row) => (row.expense_subcategory || LEGACY_SUBCATEGORY_VALUE) === selected)
}

export function summarizeOtherExpenses(rows) {
  const options = [{ value: 'all', label: '全部分类' }, ...OTHER_EXPENSE_SUBCATEGORIES, { value: LEGACY_SUBCATEGORY_VALUE, label: '未分类（历史记录）' }]
  const summary = options.map((option) => ({ ...option, amount: 0, count: 0 }))
  for (const row of rows) {
    const amount = Number(row.amount || 0)
    const value = row.expense_subcategory || LEGACY_SUBCATEGORY_VALUE
    summary[0].amount += amount
    summary[0].count += 1
    const item = summary.find((entry) => entry.value === value)
    if (item) { item.amount += amount; item.count += 1 }
  }
  return summary.filter((entry) => entry.value !== LEGACY_SUBCATEGORY_VALUE || entry.count > 0)
}
