import { apiDelete, apiGet, apiPost } from '@/lib/api/client.ts'

export type RdPrepaymentFundingMapItem = {
  id: string
  bank_transaction_id: string
  access_item_id: string
  funded_amount: number
  product_name?: string | null
  contract_name?: string | null
}

export type RdPrepaymentBankContext = Record<string, any>

const PATH = '/api/rd-prepayments'

export function getRdPrepaymentBankContext(bankTransactionId: string): Promise<RdPrepaymentBankContext> {
  return apiGet(`${PATH}/bank-context/${encodeURIComponent(bankTransactionId)}`)
}

export function getRdPrepaymentFundingMap(bankTransactionIds: string[]): Promise<{ items: RdPrepaymentFundingMapItem[] }> {
  const ids = bankTransactionIds.filter(Boolean).join(',')
  return apiGet(`${PATH}/funding-map?bank_transaction_ids=${encodeURIComponent(ids)}`)
}

export function createRdPrepaymentFunding(payload: {
  bank_transaction_id: string
  access_item_id: string
  funded_amount: number
  note?: string
}): Promise<RdPrepaymentBankContext> {
  return apiPost(`${PATH}/fundings`, payload)
}

export function deleteRdPrepaymentFunding(fundingId: string): Promise<RdPrepaymentBankContext> {
  return apiDelete(`${PATH}/fundings/${encodeURIComponent(fundingId)}`)
}

export function allocateRdPrepaymentInvoice(
  fundingId: string,
  payload: { invoice_id: string; allocated_amount: number }
): Promise<RdPrepaymentBankContext> {
  return apiPost(`${PATH}/fundings/${encodeURIComponent(fundingId)}/invoices`, payload)
}

export function deleteRdPrepaymentInvoiceAllocation(
  fundingId: string,
  allocationId: string
): Promise<RdPrepaymentBankContext> {
  return apiDelete(`${PATH}/fundings/${encodeURIComponent(fundingId)}/invoices/${encodeURIComponent(allocationId)}`)
}
