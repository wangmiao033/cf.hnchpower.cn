import { describe, expect, it } from 'vitest'

import { VIEWS } from './routes.js'
import { canOpenView, permissionForView } from './viewPermissions.js'

function canFrom(permissions) {
  const set = new Set(permissions)
  return (permission) => set.has(permission)
}

describe('view permissions', () => {
  it('uses *.view permissions for read-only views', () => {
    expect(permissionForView(VIEWS.RECON_RD)).toBe('reconciliation.view')
    expect(permissionForView(VIEWS.BANK_TRANSACTIONS_LEDGER)).toBe('funds.view')
    expect(permissionForView(VIEWS.PROFIT_ANALYSIS)).toBe('analytics.view')
    expect(permissionForView(VIEWS.SERVER_COSTS)).toBe('analytics.view')
  })

  it('requires manage permissions for create and edit views', () => {
    expect(permissionForView(VIEWS.RECON_CREATE)).toBe('reconciliation.manage')
    expect(permissionForView(VIEWS.RECON_EDIT)).toBe('reconciliation.manage')
    expect(permissionForView(VIEWS.INVOICE_CREATE)).toBe('invoices.manage')
    expect(permissionForView(VIEWS.BANK_STATEMENT_IMPORT)).toBe('funds.manage')
  })

  it('blocks viewer from write-only views', () => {
    const can = canFrom(['reconciliation.view', 'funds.view', 'invoices.view'])
    expect(canOpenView(can, VIEWS.RECON_RD)).toBe(true)
    expect(canOpenView(can, VIEWS.RECON_CREATE)).toBe(false)
    expect(canOpenView(can, VIEWS.BANK_TRANSACTIONS_LEDGER)).toBe(true)
    expect(canOpenView(can, VIEWS.BANK_STATEMENT_IMPORT)).toBe(false)
  })

  it('keeps dashboard and user center available without business module permission', () => {
    expect(permissionForView(VIEWS.DASHBOARD)).toBe(null)
    expect(permissionForView(VIEWS.USER_CENTER)).toBe(null)
    expect(canOpenView(() => false, VIEWS.DASHBOARD)).toBe(true)
  })
})
