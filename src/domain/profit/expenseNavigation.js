import { VIEWS } from '@/app/routes.js'

/**
 * Route legacy profit-ledger records to the canonical operating expense centre.
 * Payroll-backed rows must never be edited with the generic expense form because
 * doing so bypasses employee deductions and payroll batch state.
 */
export function ledgerViewForExpense(expense) {
  if (expense?.category === 'payroll' || expense?.expense_kind === 'payroll') return VIEWS.PAYROLL_EXPENSES
  if (expense?.expense_kind === 'office_rent') return VIEWS.OFFICE_RENT
  if (expense?.expense_kind === 'software_subscription') return VIEWS.SOFTWARE_EXPENSES
  if (expense?.category === 'other' || expense?.expense_kind === 'other') return VIEWS.OTHER_EXPENSES
  // Historical tax/marketing/general-office costs have no specialized edit screen.
  return VIEWS.OPERATING_EXPENSES
}
