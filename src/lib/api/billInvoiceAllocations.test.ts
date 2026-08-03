import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client.ts', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn()
}))

import { apiGet } from '@/lib/api/client.ts'
import {
  getInvoiceBillSummary,
  listInvoiceAllocationOverviews
} from '@/lib/api/billInvoiceAllocations.ts'

describe('发票账单关联 API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('没有发票时不发起汇总请求', async () => {
    await expect(listInvoiceAllocationOverviews([])).resolves.toEqual([])
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('批量汇总请求会去重并编码发票 ID', async () => {
    vi.mocked(apiGet).mockResolvedValue([])

    await listInvoiceAllocationOverviews(['invoice-1', 'invoice/2', 'invoice-1'])

    expect(apiGet).toHaveBeenCalledWith(
      '/api/bill-invoice-allocations/invoices/overview?invoice_ids=invoice-1%2Cinvoice%2F2'
    )
  })

  it('单张发票关联详情使用安全路径', async () => {
    vi.mocked(apiGet).mockResolvedValue({})

    await getInvoiceBillSummary('invoice/2')

    expect(apiGet).toHaveBeenCalledWith('/api/bill-invoice-allocations/invoice/invoice%2F2')
  })
})
