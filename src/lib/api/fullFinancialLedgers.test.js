import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client.ts', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  apiPostMultipart: vi.fn(),
  parseResponse: vi.fn(),
  API_BASE_URL: ''
}))
vi.mock('@/lib/api/contractNumbers.ts', () => ({
  listInternalContractNumbers: vi.fn(async () => ({ items: [] })),
  clearInternalContractNumbersCache: vi.fn()
}))

import { apiGet } from '@/lib/api/client.ts'
import { getAllBankTransactions } from './bankTransaction.ts'
import { listAllContracts } from './contract.ts'

function generateRows(total, title) {
  return Array.from({ length: total }, (_, index) => ({
    id: String(index + 1), amount: index + 1,
    contract_name: title, internal_contract_no: String(index + 1)
  }))
}

beforeEach(() => vi.clearAllMocks())

describe('complete bank ledger and contract register', () => {
  it('loads all 1,203 bank records instead of silently stopping at 500', async () => {
    const rows = generateRows(1203, '银行流水')
    apiGet.mockImplementation(async (path) => {
      expect(path).toContain('/api/bank-transactions?')
      const query = new URLSearchParams(path.split('?')[1])
      expect(query.get('q')).toBe('某合作方')
      const offset = Number(query.get('offset') || 0)
      const limit = Number(query.get('limit') || 50)
      return { items: rows.slice(offset, offset + limit), total: rows.length }
    })
    const result = await getAllBankTransactions({ q: '某合作方' })
    expect(result.items).toHaveLength(1203)
    expect(result.total).toBe(1203)
    expect(apiGet).toHaveBeenCalledTimes(3)
  })

  it('loads every contract, retaining first-page server summary for the overview', async () => {
    const rows = generateRows(1007, '合同')
    apiGet.mockImplementation(async (path) => {
      expect(path).toContain('/api/contracts?')
      const query = new URLSearchParams(path.split('?')[1])
      const offset = Number(query.get('offset') || 0)
      const limit = Number(query.get('limit') || 50)
      return {
        items: rows.slice(offset, offset + limit),
        total: rows.length,
        summary: { total: 1007, linked: 1006, amount_total: '600000' }
      }
    })
    const result = await listAllContracts()
    expect(result.items).toHaveLength(1007)
    expect(result.summary.total).toBe(1007)
    expect(result.summary.amount_total).toBe('600000')
  })

  it('never presents incomplete results as a full ledger when the next page fails', async () => {
    const rows = generateRows(800, '流水')
    apiGet.mockImplementation(async (path) => {
      const query = new URLSearchParams(path.split('?')[1])
      if (Number(query.get('offset') || 0) !== 0) throw new Error('网络中断')
      return { items: rows.slice(0, 500), total: 800 }
    })
    await expect(getAllBankTransactions()).rejects.toThrow('网络中断')
  })
})
