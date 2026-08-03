import { API_BASE_URL, apiDelete, apiGet, apiPostMultipart } from './client'

export type BillType = 'rd' | 'channel'

export type BillAttachment = {
  id: string
  bill_type: BillType
  bill_id: string
  file_name: string
  file_type?: string | null
  file_size: number
  created_at?: string | null
}

const basePath = (billType: BillType, billId: string) =>
  `/api/bill-attachments/${billType}/${encodeURIComponent(billId)}`

export async function listBillAttachments(billType: BillType, billId: string) {
  const data = await apiGet<{ items: BillAttachment[] }>(basePath(billType, billId))
  return data.items || []
}

export async function uploadBillAttachment(billType: BillType, billId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return apiPostMultipart<BillAttachment>(basePath(billType, billId), form)
}

export async function deleteBillAttachment(billType: BillType, billId: string, attachmentId: string) {
  return apiDelete(`${basePath(billType, billId)}/${encodeURIComponent(attachmentId)}`)
}

export function billAttachmentFileUrl(
  billType: BillType,
  billId: string,
  attachmentId: string,
  inline = true,
) {
  return `${API_BASE_URL}${basePath(billType, billId)}/${encodeURIComponent(attachmentId)}/file?inline=${inline}`
}
