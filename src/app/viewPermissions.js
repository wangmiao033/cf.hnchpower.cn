import { VIEWS } from '@/app/routes.js'

export const VIEW_PERMISSIONS = Object.freeze({
  [VIEWS.FINANCE_WORKBENCH]: 'finance_tasks.view',
  [VIEWS.SERVER_COSTS]: 'analytics.view',
  [VIEWS.BUSINESS_DASHBOARD]: 'analytics.view',
  [VIEWS.PROFIT_ANALYSIS]: 'analytics.view',
  [VIEWS.ANOMALIES]: 'anomalies.view',
  [VIEWS.BANK_RECONCILIATION]: 'funds.view',
  [VIEWS.BANK_TRANSACTIONS_LEDGER]: 'funds.view',
  [VIEWS.BANK_STATEMENT_IMPORT]: 'funds.manage',
  [VIEWS.RECON_RD]: 'reconciliation.view',
  [VIEWS.RECON_PROGRESS]: 'reconciliation.view',
  [VIEWS.RECON_CREATE]: 'reconciliation.manage',
  [VIEWS.RECON_EDIT]: 'reconciliation.manage',
  [VIEWS.RECON_CHANNEL]: 'reconciliation.view',
  [VIEWS.CHANNEL_RECON_CREATE]: 'reconciliation.manage',
  [VIEWS.CHANNEL_RECON_EDIT]: 'reconciliation.manage',
  [VIEWS.CONTRACTS]: 'contracts.view',
  [VIEWS.INVOICE_MANAGE]: 'invoices.view',
  [VIEWS.INVOICE_INPUT]: 'invoices.view',
  [VIEWS.INVOICE_CREATE]: 'invoices.manage',
  [VIEWS.INVOICE_EDIT]: 'invoices.manage',
  [VIEWS.QUICKSDK_LIBRARY]: 'data.view',
  [VIEWS.PRODUCT_SOURCES]: 'data.view',
  [VIEWS.QUICKSDK_GAMES]: 'data.view',
  [VIEWS.QUICKSDK_CHANNELS]: 'data.view',
  [VIEWS.PARTNER_CONTACTS]: 'partners.view'
})

export function permissionForView(view) {
  return VIEW_PERMISSIONS[view] || null
}

export function canOpenView(can, view) {
  const permission = permissionForView(view)
  return !permission || Boolean(can?.(permission))
}
