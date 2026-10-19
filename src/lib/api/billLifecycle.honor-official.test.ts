import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), snapshot: vi.fn(), contract: vi.fn(), cases: vi.fn() }))
vi.mock('./client.ts', () => ({ apiGet: mocks.get, apiPost: mocks.post }))
vi.mock('./contractTerms.ts', () => ({ getContractBillReconciliation: mocks.contract, createContractReconciliationSnapshot: mocks.snapshot }))
vi.mock('./contractDifferences.ts', () => ({ listContractDifferenceCases: mocks.cases }))
import { assertContractReadyForPlatformTail, confirmReviewedChannelPlatformVariance } from './billLifecycle.ts'
const review: any = {
  policyCode: 'honor_official_statement_v1', partnerId: 'HONOR-ID', reviewKind: 'documented',
  systemAmount: 2009.25, platformAmount: 2009.46, settlementAmount: 2009.46, differenceCents: -21, lineIds: ['L1'],
  officialLines: [{ line_id: 'L1', game_name: '六界仙尊', settlement_cycle: '2026-08', system_amount: 2009.25, platform_amount: 2009.46 }]
}
const preflight = () => ({ bill_checks: [], lines: [{ line_id: 'L1', game_name: '六界仙尊', settlement_cycle: '2026-08', status: 'fail',
  match: { contract_id: 'C', access_item_id: 'A', confidence: 'high' },
  checks: [{ key: 'authorization', status: 'pass' }, { key: 'share_rate', status: 'pass' }, { key: 'contract_standard_settlement', status: 'fail' }],
  contract_amount: { status: 'fail', actual_amount: 2009.46, expected_amount: 2009.25, deterministic: true, supported: true }
}] })
beforeEach(() => { vi.resetAllMocks(); mocks.contract.mockResolvedValue(preflight()); mocks.snapshot.mockResolvedValue({ id: 'S' }); mocks.post.mockResolvedValue({ status: 'confirmed' }); mocks.cases.mockResolvedValue({ items: [] }) })
describe('Honor official-source confirmation', () => {
  it('permits only the amount comparison in complete matched contract evidence', async () => {
    await expect(assertContractReadyForPlatformTail('B', review)).resolves.toBeUndefined()
    await expect(assertContractReadyForPlatformTail('B')).rejects.toThrow('合同核对未通过')
  })
  it.each(['authorization', 'share_rate', 'channel_fee_rate', 'tax_rate'])('keeps %s failures blocking', async key => {
    const data = preflight(); data.lines[0].checks.push({ key, status: 'fail' }); mocks.contract.mockResolvedValue(data)
    await expect(assertContractReadyForPlatformTail('B', review)).rejects.toThrow('只处理金额比较差异')
  })
  it('rejects missing service, missing lines and changed amounts', async () => {
    mocks.contract.mockRejectedValueOnce(new Error('offline'))
    await expect(assertContractReadyForPlatformTail('B', review)).rejects.toThrow('服务暂时不可用')
    mocks.contract.mockResolvedValueOnce({ lines: [] })
    await expect(assertContractReadyForPlatformTail('B', review)).rejects.toThrow('完整的游戏明细')
    const data = preflight(); data.lines[0].contract_amount.actual_amount = 2009.25; mocks.contract.mockResolvedValue(data)
    await expect(assertContractReadyForPlatformTail('B', review)).rejects.toThrow('只处理金额比较差异')
  })
  it('creates authoritative snapshot before POST, sends exact per-game source attestation', async () => {
    await confirmReviewedChannelPlatformVariance('B', '审核记录', review, 'ATT', true, review.officialLines, '逐游戏核对荣耀官方结算单')
    expect(mocks.snapshot.mock.calls[0]).toEqual(['channel', 'B', review.policyCode])
    expect(mocks.post).toHaveBeenCalledWith('/api/bill-lifecycle/channel/B/confirm-platform-variance', expect.objectContaining({
      official_statement_policy: review.policyCode, expected_partner_id: 'HONOR-ID', evidence_attachment_id: 'ATT',
      official_line_confirmations: review.officialLines, contract_snapshot_id: 'S', official_statement_reason: '逐游戏核对荣耀官方结算单'
    }))
    expect(mocks.snapshot.mock.invocationCallOrder[0]).toBeLessThan(mocks.post.mock.invocationCallOrder[0])
  })
  it('does not submit when authoritative snapshot cannot be created', async () => {
    mocks.snapshot.mockRejectedValueOnce(new Error('snapshot unavailable'))
    await expect(confirmReviewedChannelPlatformVariance('B', '审核记录', review, 'ATT', true, review.officialLines, '官方结算核对')).rejects.toThrow()
    expect(mocks.post).not.toHaveBeenCalled()
  })
})
