import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),snapshot:vi.fn(),contract:vi.fn(),cases:vi.fn()}))
vi.mock('./client.ts',()=>({apiGet:mocks.get,apiPost:mocks.post}))
vi.mock('./contractTerms.ts',()=>({getContractBillReconciliation:mocks.contract,createContractReconciliationSnapshot:mocks.snapshot}))
vi.mock('./contractDifferences.ts',()=>({listContractDifferenceCases:mocks.cases}))
import { getChannelManualReviewException, confirmReviewedChannelPlatformVariance, assertContractReadyForPlatformTail } from './billLifecycle.ts'
const review:any={reviewKind:'documented',systemAmount:135.85,platformAmount:144.4,settlementAmount:144.4,differenceCents:-855,lineIds:['L1'],
  manualException:{code:'4399_july_2026_single_bill_v1',partner_id:'partner',review_revision:'a'.repeat(64)}}
beforeEach(()=>{vi.resetAllMocks();mocks.post.mockResolvedValue({status:'confirmed'});mocks.snapshot.mockResolvedValue({id:'snapshot'})})
describe('single bill manual review API',()=>{
  it('requests server eligibility against the exact editor timestamp',async()=>{
    await getChannelManualReviewException('B','2026-10-22T03:00:00.123456+00:00')
    expect(mocks.get).toHaveBeenCalledWith('/api/bill-lifecycle/channel/B/manual-review-exception?expected_updated_at=2026-10-22T03%3A00%3A00.123456%2B00%3A00')
  })
  it('sends separate written basis, explicit consent, identity and revision without invented attachment',async()=>{
    await confirmReviewedChannelPlatformVariance('B','审计说明',review,'',false,[],'',true,'已逐项核实真实对账来源，明确确认本次单笔例外')
    expect(mocks.post).toHaveBeenCalledWith('/api/bill-lifecycle/channel/B/confirm-platform-variance',expect.objectContaining({
      manual_review_exception:review.manualException.code,manual_review_revision:'a'.repeat(64),manual_review_confirmed:true,
      manual_review_reason:'已逐项核实真实对账来源，明确确认本次单笔例外',expected_partner_id:'partner',
      evidence_attachment_id:null,evidence_confirmed:false,expected_system_amount:135.85,expected_platform_amount:144.4
    }))
    expect(mocks.snapshot.mock.calls).toEqual([['channel','B','confirmed']])
  })
  it('cannot silently infer explicit consent from the exception metadata',async()=>{
    await confirmReviewedChannelPlatformVariance('B','审核记录',review)
    expect(mocks.post.mock.calls[0][1].manual_review_confirmed).toBe(false)
    expect(mocks.post.mock.calls[0][1].manual_review_reason).toBe('')
  })
  it('still blocks when contract preflight is absent or the service fails',async()=>{
    mocks.contract.mockResolvedValueOnce({lines:[]})
    await expect(assertContractReadyForPlatformTail('B',review)).rejects.toThrow('完整的游戏明细')
    mocks.contract.mockRejectedValueOnce(new Error('offline'))
    await expect(assertContractReadyForPlatformTail('B',review)).rejects.toThrow('服务暂时不可用')
    expect(mocks.post).not.toHaveBeenCalled()
  })
})
