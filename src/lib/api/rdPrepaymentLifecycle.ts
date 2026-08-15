import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api/client.ts'

const PATH = '/api/rd-prepayment-lifecycle'

export type RdPrepaymentLifecyclePool = Record<string, any>
export type RdPrepaymentLifecycleDetail = {
  pool: RdPrepaymentLifecyclePool
  installments: Array<Record<string, any>>
  refunds: Array<Record<string, any>>
  invoice_releases: Array<Record<string, any>>
  refund_candidates: Array<Record<string, any>>
}

export type RdPrepaymentLifecycleWorkbench = {
  schema_ready: boolean
  stats: Record<string, number>
  items: RdPrepaymentLifecyclePool[]
}

export function getRdPrepaymentLifecycleWorkbench(): Promise<RdPrepaymentLifecycleWorkbench> {
  return apiGet(`${PATH}/workbench`)
}

export function getRdPrepaymentLifecycleDetail(accessItemId: string): Promise<RdPrepaymentLifecycleDetail> {
  return apiGet(`${PATH}/pools/${encodeURIComponent(accessItemId)}`)
}

export function saveRdPrepaymentLifecycleSettings(
  accessItemId: string,
  payload: { strict_mode: boolean; display_name?: string; invoice_policy?: string }
): Promise<RdPrepaymentLifecycleDetail> {
  return apiPut(`${PATH}/pools/${encodeURIComponent(accessItemId)}/settings`, payload)
}

export function createRdPrepaymentInstallment(
  accessItemId: string,
  payload: Record<string, any>
): Promise<RdPrepaymentLifecycleDetail> {
  return apiPost(`${PATH}/pools/${encodeURIComponent(accessItemId)}/installments`, payload)
}

export function updateRdPrepaymentInstallment(
  installmentId: string,
  payload: Record<string, any>
): Promise<RdPrepaymentLifecycleDetail> {
  return apiPut(`${PATH}/installments/${encodeURIComponent(installmentId)}`, payload)
}

export function deleteRdPrepaymentInstallment(installmentId: string): Promise<void> {
  return apiDelete(`${PATH}/installments/${encodeURIComponent(installmentId)}`)
}

export function triggerRdPrepaymentInstallment(
  installmentId: string,
  triggerDate?: string
): Promise<RdPrepaymentLifecycleDetail> {
  return apiPost(`${PATH}/installments/${encodeURIComponent(installmentId)}/trigger`, {
    trigger_date: triggerDate || undefined
  })
}

export function markRdPrepaymentInstallmentInvoiceReady(
  installmentId: string,
  invoiceReference = ''
): Promise<RdPrepaymentLifecycleDetail> {
  return apiPost(`${PATH}/installments/${encodeURIComponent(installmentId)}/invoice-ready`, {
    invoice_reference: invoiceReference
  })
}

export function freezeRdPrepaymentPool(accessItemId: string, reason: string): Promise<RdPrepaymentLifecycleDetail> {
  return apiPost(`${PATH}/pools/${encodeURIComponent(accessItemId)}/freeze`, { reason })
}

export function unfreezeRdPrepaymentPool(accessItemId: string): Promise<RdPrepaymentLifecycleDetail> {
  return apiPost(`${PATH}/pools/${encodeURIComponent(accessItemId)}/unfreeze`, {})
}

export function registerRdPrepaymentRefund(
  accessItemId: string,
  payload: { bank_transaction_id: string; refund_amount: number; note?: string }
): Promise<RdPrepaymentLifecycleDetail> {
  return apiPost(`${PATH}/pools/${encodeURIComponent(accessItemId)}/refunds`, payload)
}

export function releaseRdPrepaymentInvoices(accessItemId: string): Promise<{
  released_amount: number
  release_count: number
  detail: RdPrepaymentLifecycleDetail
}> {
  return apiPost(`${PATH}/pools/${encodeURIComponent(accessItemId)}/release-invoices`, {})
}
