import { describe, expect, it } from 'vitest'
import { VIEWS } from '@/app/routes.js'
import { ledgerViewForExpense } from './expenseNavigation.js'

describe('profit expense ledger navigation', () => {
  it('sends payroll records to their dedicated employee-level ledger', () => {
    expect(ledgerViewForExpense({ category: 'payroll', expense_kind: 'payroll' })).toBe(VIEWS.PAYROLL_EXPENSES)
  })
  it('routes dedicated categories to the correct pages', () => {
    expect(ledgerViewForExpense({ category: 'office', expense_kind: 'office_rent' })).toBe(VIEWS.OFFICE_RENT)
    expect(ledgerViewForExpense({ category: 'platform', expense_kind: 'software_subscription' })).toBe(VIEWS.SOFTWARE_EXPENSES)
    expect(ledgerViewForExpense({ category: 'other', expense_kind: 'other' })).toBe(VIEWS.OTHER_EXPENSES)
  })
  it('does not force legacy marketing/tax rows into an unrelated category', () => {
    expect(ledgerViewForExpense({ category: 'marketing', expense_kind: 'marketing' })).toBe(VIEWS.OPERATING_EXPENSES)
    expect(ledgerViewForExpense({ category: 'tax' })).toBe(VIEWS.OPERATING_EXPENSES)
  })
})
