/** Customer/legal-party timelines and bank-owned receiving accounts. */
import { apiGet, apiPost, apiPut } from '@/lib/api/client.ts'

export type LegalEntityRole = 'contract' | 'payer' | 'invoice'
export type LegalEntityLink = {
  id: string; partner_id: string; entity_id: string; role: LegalEntityRole
  legal_name: string; tax_registration_no: string
  effective_month: string; end_month: string | null; note: string
}
export type PartnerEntityResponse = {
  partner: { id: string; name: string; short_name: string }
  links: LegalEntityLink[]
}
export type PartnerEntityResolution = {
  partner_id: string; month: string
  contract: LegalEntityLink | null
  payer: LegalEntityLink | null
  invoice: LegalEntityLink | null
}
export type OwnReceivingAccount = {
  id: string; entity_id: string; legal_name: string; tax_registration_no: string
  account_no: string; bank_name: string; currency: string
  account_label: string; is_active: boolean; created_at: string
}

const PATH = '/api/legal-entities'
const customer = (partnerId: string) => PATH + '/partners/' + encodeURIComponent(partnerId)

export function getPartnerEntities(partnerId: string) {
  return apiGet<PartnerEntityResponse>(customer(partnerId))
}
export function getPartnerEntityResolution(partnerId: string, month: string) {
  return apiGet<PartnerEntityResolution>(customer(partnerId) + '/resolution?month=' + encodeURIComponent(month))
}
export function createPartnerEntityLink(partnerId: string, input: {
  legal_name: string; role: LegalEntityRole; effective_month: string
  end_month?: string | null; tax_registration_no?: string; note?: string
}) {
  return apiPost<PartnerEntityResponse>(customer(partnerId) + '/links', input)
}
export function updatePartnerEntityLink(partnerId: string, linkId: string, input: {
  end_month?: string | null; note?: string
}) {
  return apiPut<{ links: LegalEntityLink[] }>(
    customer(partnerId) + '/links/' + encodeURIComponent(linkId), input
  )
}
export function getOwnBankAccounts() {
  return apiGet<{ items: OwnReceivingAccount[] }>(PATH + '/own-accounts')
}
export function createOwnBankAccount(input: {
  legal_name: string; account_no: string; bank_name?: string
  currency?: string; account_label?: string; tax_registration_no?: string
}) {
  return apiPost<{ id: string; entity_id: string; legal_name: string }>(PATH + '/own-accounts', input)
}
export function setOwnBankAccountActive(id: string, active: boolean) {
  return apiPut<{ id: string; is_active: boolean }>(
    PATH + '/own-accounts/' + encodeURIComponent(id) + '/active?active=' + String(active), {}
  )
}
export function getBankTransactionIdentities(id: string) {
  return apiGet<{
    transaction_id: string; direction: string
    bank_payer_name: string | null; bank_payee_name: string | null
    payer_customer: Record<string, unknown> | null
    own_receiver: { entity_id: string; legal_name: string; bank_account_id: string } | null
    own_receiver_verified_by_account: boolean
    warning: string | null
  }>(PATH + '/bank-transactions/' + encodeURIComponent(id) + '/identities')
}


export type CustomerContractSource = {
  partner_id: string
  month: string
  contract_party_name: string | null
  source: 'configured_contract_entity' | 'existing_customer_contract' | 'unresolved'
  message: string
}

export function getCustomerContractSource(partnerId: string, month: string) {
  return apiGet<CustomerContractSource>(
    customer(partnerId) + '/contract-source?month=' + encodeURIComponent(month)
  )
}
