import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api/client.ts'

export type ApiPartnerRow = {
  id: string
  name: string
  short_name: string
  category: string
  tag: string
  tax_registration_no: string
  bank_name: string
  bank_account: string
  invoice_content: string
  recipient: string
  recipient_phone: string
  mailing_address: string
  created_at: string
  updated_at: string
}

export type PartnerListResponse = {
  items: ApiPartnerRow[]
  total: number
  bootstrapped?: boolean
}

export type PartnerPayload = {
  name: string
  short_name: string
  category: string
  tag: string
  tax_registration_no: string
  bank_name: string
  bank_account: string
  invoice_content: string
  recipient: string
  recipient_phone: string
  mailing_address: string
}

const PATH = '/api/partners'

export function listPartners(params?: { q?: string; category?: string }) {
  const query = new URLSearchParams()
  if (params?.q) query.set('q', params.q)
  if (params?.category) query.set('category', params.category)
  const qs = query.toString()
  return apiGet<PartnerListResponse>(`${PATH}${qs ? `?${qs}` : ''}`)
}

export function createPartner(payload: PartnerPayload) {
  return apiPost<ApiPartnerRow>(PATH, payload)
}

export function updatePartner(id: string, payload: PartnerPayload) {
  return apiPut<ApiPartnerRow>(`${PATH}/${encodeURIComponent(id)}`, payload)
}

export function deletePartner(id: string) {
  return apiDelete(`${PATH}/${encodeURIComponent(id)}`)
}

export function importPartners(partners: Array<Record<string, unknown>>) {
  return apiPost<{ imported: number }>(`${PATH}/import`, {
    items: partners.map(frontendPartnerToPayload)
  })
}

export function apiPartnerRowToFrontend(row: ApiPartnerRow): Record<string, unknown> {
  return {
    id: String(row.id),
    name: row.name ?? '',
    shortName: row.short_name ?? '',
    category: row.category || '研发商',
    tag2: row.tag ?? '',
    taxRegistrationNo: row.tax_registration_no ?? '',
    bankName: row.bank_name ?? '',
    bankAccount: row.bank_account ?? '',
    invoiceContent: row.invoice_content ?? '',
    recipient: row.recipient ?? '',
    recipientPhone: row.recipient_phone ?? '',
    mailingAddress: row.mailing_address ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function frontendPartnerToPayload(
  partner: Record<string, unknown>
): PartnerPayload {
  return {
    name: String(partner.name ?? '').trim(),
    short_name: String(partner.shortName ?? partner.short_name ?? '').trim(),
    category: String(partner.category || '研发商').trim(),
    tag: String(partner.tag2 ?? partner.tag ?? '').trim(),
    tax_registration_no: String(
      partner.taxRegistrationNo ?? partner.tax_registration_no ?? ''
    ).trim(),
    bank_name: String(partner.bankName ?? partner.bank_name ?? '').trim(),
    bank_account: String(partner.bankAccount ?? partner.bank_account ?? '').trim(),
    invoice_content: String(
      partner.invoiceContent ?? partner.invoice_content ?? ''
    ).trim(),
    recipient: String(partner.recipient ?? '').trim(),
    recipient_phone: String(
      partner.recipientPhone ?? partner.recipient_phone ?? ''
    ).trim(),
    mailing_address: String(
      partner.mailingAddress ?? partner.mailing_address ?? ''
    ).trim()
  }
}
