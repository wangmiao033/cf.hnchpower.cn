import { apiGet } from '@/lib/api/client.ts'

export type InternalContractNumberRow = {
  contract_id: string
  internal_contract_no: string
  number_month: string
  sequence_no: number
}

export type InternalContractNumbersResponse = {
  items: InternalContractNumberRow[]
  total: number
}

export function listInternalContractNumbers() {
  return apiGet<InternalContractNumbersResponse>('/api/contracts/internal-numbers')
}
