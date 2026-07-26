import {
  API_BASE_URL,
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  parseResponse
} from '@/lib/api/client.ts'

export type ApiContractAttachment = {
  id: string
  expected_name: string
  file_name: string
  content_type: string
  size_bytes: number
  source: 'wps' | 'manual'
  preview_url: string
  download_url: string
  created_at: string
}

export type ApiContractRow = {
  id: string
  source: string
  contract_name: string
  contract_type: string
  amount: string | null
  counterparty: string
  contract_no: string
  signing_date: string | null
  signing_status: string
  effective_date: string | null
  end_date: string | null
  performance_status: string
  payment_type: string
  attachments: string[]
  attachment_files: ApiContractAttachment[]
  partner_id: string | null
  partner_name: string | null
  partner_short_name: string | null
  partner_link_status: 'linked' | 'unlinked'
  timeline_status: '生效中' | '即将到期' | '已过期' | '待生效'
  contract_no_duplicate: boolean
  created_at: string
  updated_at: string
}

export type ContractSummary = {
  total: number
  linked: number
  expiring_30: number
  expired: number
  amount_total: string
}

export type ContractListResponse = {
  items: ApiContractRow[]
  total: number
  summary: ContractSummary
}

export type ContractPayload = {
  contract_name: string
  contract_type?: string
  amount?: string | number | null
  counterparty?: string
  contract_no?: string
  signing_date?: string | null
  signing_status?: string
  effective_date?: string | null
  end_date?: string | null
  performance_status?: string
  payment_type?: string
  attachments?: string[] | string
}

export type ContractImportResult = {
  created: number
  updated: number
  skipped: number
  total: number
  linked: number
  unlinked: number
  duplicate_contract_numbers: Array<{ contract_no: string; count: number }>
}

export type ContractAttachmentUploadResult = {
  contract: ApiContractRow
  attachment: ApiContractAttachment
  deduplicated: boolean
}

const PATH = '/api/contracts'

export function listContracts(params?: {
  q?: string
  contractType?: string
  paymentType?: string
  timelineStatus?: string
  limit?: number
  offset?: number
}) {
  const query = new URLSearchParams()
  if (params?.q) query.set('q', params.q)
  if (params?.contractType) query.set('contract_type', params.contractType)
  if (params?.paymentType) query.set('payment_type', params.paymentType)
  if (params?.timelineStatus) query.set('timeline_status', params.timelineStatus)
  if (params?.limit != null) query.set('limit', String(params.limit))
  if (params?.offset != null) query.set('offset', String(params.offset))
  const qs = query.toString()
  return apiGet<ContractListResponse>(`${PATH}${qs ? `?${qs}` : ''}`)
}

export function importContracts(items: ContractPayload[]) {
  return apiPost<ContractImportResult>(`${PATH}/import`, { items })
}

export function relinkContracts() {
  return apiPost<{ updated: number; linked: number }>(`${PATH}/relink`, {})
}

export function createContract(payload: ContractPayload) {
  return apiPost<ApiContractRow>(PATH, payload)
}

export function updateContract(id: string, payload: ContractPayload) {
  return apiPut<ApiContractRow>(`${PATH}/${encodeURIComponent(id)}`, payload)
}

export function deleteContract(id: string) {
  return apiDelete(`${PATH}/${encodeURIComponent(id)}`)
}

export async function uploadContractAttachment(
  contractId: string,
  file: File,
  expectedName = ''
): Promise<ContractAttachmentUploadResult> {
  let response: Response
  try {
    response = await fetch(
      `${API_BASE_URL}${PATH}/${encodeURIComponent(contractId)}/attachments`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
          'X-Expected-Name': encodeURIComponent(expectedName)
        },
        body: file
      }
    )
  } catch {
    throw new Error('附件上传失败，请检查网络后重试。')
  }
  return parseResponse<ContractAttachmentUploadResult>(response)
}
