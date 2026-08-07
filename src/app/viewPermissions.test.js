import test from 'node:test'
import assert from 'node:assert/strict'

import { VIEWS } from './routes.js'
import { canOpenView, permissionForView } from './viewPermissions.js'

function canFrom(permissions) {
  const set = new Set(permissions)
  return (permission) => set.has(permission)
}

test('read-only views use *.view permissions', () => {
  assert.equal(permissionForView(VIEWS.RECON_RD), 'reconciliation.view')
  assert.equal(permissionForView(VIEWS.BANK_TRANSACTIONS_LEDGER), 'funds.view')
  assert.equal(permissionForView(VIEWS.PROFIT_ANALYSIS), 'analytics.view')
})

test('create and edit views require manage permissions', () => {
  assert.equal(permissionForView(VIEWS.RECON_CREATE), 'reconciliation.manage')
  assert.equal(permissionForView(VIEWS.RECON_EDIT), 'reconciliation.manage')
  assert.equal(permissionForView(VIEWS.INVOICE_CREATE), 'invoices.manage')
  assert.equal(permissionForView(VIEWS.BANK_STATEMENT_IMPORT), 'funds.manage')
})

test('viewer cannot open write-only views', () => {
  const can = canFrom(['reconciliation.view', 'funds.view', 'invoices.view'])
  assert.equal(canOpenView(can, VIEWS.RECON_RD), true)
  assert.equal(canOpenView(can, VIEWS.RECON_CREATE), false)
  assert.equal(canOpenView(can, VIEWS.BANK_TRANSACTIONS_LEDGER), true)
  assert.equal(canOpenView(can, VIEWS.BANK_STATEMENT_IMPORT), false)
})

test('dashboard and user center have no business module permission requirement', () => {
  assert.equal(permissionForView(VIEWS.DASHBOARD), null)
  assert.equal(permissionForView(VIEWS.USER_CENTER), null)
  assert.equal(canOpenView(() => false, VIEWS.DASHBOARD), true)
})
