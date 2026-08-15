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

// 内部合同编号属于低频变化元数据。合同新增/导入/删除时由 contract.ts 精确失效，
// 日常列表读取可安全复用，避免合同页、360° 与异常巡检反复请求同一份编号表。
const TTL_MS = 30_000
let cached: { value: InternalContractNumbersResponse; expiresAt: number } | null = null
let inflight: Promise<InternalContractNumbersResponse> | null = null

export function clearInternalContractNumbersCache() {
  cached = null
  inflight = null
}

export function listInternalContractNumbers() {
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
  if (cached) cached = null
  if (inflight) return inflight

  const request = apiGet<InternalContractNumbersResponse>('/api/contracts/internal-numbers')
    .then((value) => {
      cached = { value, expiresAt: Date.now() + TTL_MS }
      return value
    })
    .finally(() => {
      if (inflight === request) inflight = null
    })
  inflight = request
  return request
}
