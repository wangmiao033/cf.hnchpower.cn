import { apiGet } from '@/lib/api/client.ts'
import type { ApiContractRow } from '@/lib/api/contract.ts'
import { listInternalContractNumbers } from '@/lib/api/contractNumbers.ts'

export async function getGlobalSearchContract(id: string): Promise<ApiContractRow> {
  const contract = await apiGet<ApiContractRow>(`/api/contracts/${encodeURIComponent(id)}`)
  try {
    const numbering = await listInternalContractNumbers()
    const match = (numbering.items || []).find((item) => String(item.contract_id) === String(id))
    return {
      ...contract,
      internal_contract_no: match?.internal_contract_no || contract.internal_contract_no || ''
    }
  } catch (error) {
    console.warn('Contract internal number lookup unavailable in global search.', error)
    return contract
  }
}
