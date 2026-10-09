import { describe, expect, it } from 'vitest'
import { expenseSubcategoryLabel, filterOtherExpenses, summarizeOtherExpenses } from './subcategories.js'

describe('other operating expense classification', () => {
  const rows = [
    { id: '1', amount: 12.5, expense_subcategory: 'courier_logistics' },
    { id: '2', amount: 7.5, expense_subcategory: 'courier_logistics' },
    { id: '3', amount: 8, expense_subcategory: 'office_supplies' },
    { id: '4', amount: 2, expense_subcategory: null }
  ]

  it('totals all expense subcategories without losing legacy uncategorized records', () => {
    const summary = summarizeOtherExpenses(rows)
    expect(summary.find((x) => x.value === 'all')).toMatchObject({ amount: 30, count: 4 })
    expect(summary.find((x) => x.value === 'courier_logistics')).toMatchObject({ amount: 20, count: 2 })
    expect(summary.find((x) => x.value === 'unclassified')).toMatchObject({ amount: 2, count: 1 })
    expect(summary.find((x) => x.value === 'miscellaneous')).toMatchObject({ amount: 0, count: 0 })
  })

  it('filters by subcategory and preserves an all option', () => {
    expect(filterOtherExpenses(rows, 'courier_logistics').map((row) => row.id)).toEqual(['1', '2'])
    expect(filterOtherExpenses(rows, 'unclassified').map((row) => row.id)).toEqual(['4'])
    expect(filterOtherExpenses(rows, 'all')).toEqual(rows)
  })

  it('shows translated labels with a safe historical fallback', () => {
    expect(expenseSubcategoryLabel('courier_logistics')).toBe('快递物流费')
    expect(expenseSubcategoryLabel(null)).toBe('未分类（历史记录）')
  })
})
