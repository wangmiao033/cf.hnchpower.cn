import { apiGet, apiPost } from '@/lib/api/client.ts'
import {
  createContractReconciliationSnapshot,
  getContractBillReconciliation
} from '@/lib/api/contractTerms.ts'

export type BillTransitionOption = {
  status: string
  label: string
  available: boolean
  blocked_reason?: string | null
  requires_reason: boolean
  danger: boolean
}

export type BillLifecycle = {
  bill_type: 'rd' | 'channel'
  bill_id: string
  status: string
  status_label: string
  locked: boolean
  final: boolean
  payment_phase: 'unpaid' | 'partial' | 'paid' | string
  payment_label: string
  bill_amount: number
  paid_amount: number
  invoice_coverage_status: 'none' | 'partial' | 'complete' | 'over' | string
  invoice_coverage_percent: number
  invoice_allocated_amount: number
  invoice_remaining_amount: number
  transitions: BillTransitionOption[]
}

export function getBillLifecycle(
  billType: 'rd' | 'channel',
  billId: string
): Promise<BillLifecycle> {
  return apiGet(`/api/bill-lifecycle/${encodeURIComponent(billType)}/${encodeURIComponent(billId)}`)
}

export async function transitionBillLifecycle(
  billType: 'rd' | 'channel',
  billId: string,
  toStatus: string,
  reason = ''
): Promise<BillLifecycle> {
  if (toStatus === 'confirmed') {
    let preflight = null
    try {
      preflight = await getContractBillReconciliation(billType, billId)
    } catch (preflightError) {
      // Historical data or a temporarily unavailable contract service must not
      // freeze accounting. Missing/unmatched contract evidence remains a soft
      // warning; only a successfully computed explicit difference is blocked.
      console.warn('Contract reconciliation preflight unavailable', preflightError)
    }

    const failCount = Number(preflight?.summary?.fail_count || 0)
    if (failCount > 0) {
      throw new Error(
        `合同核验发现 ${failCount} 条明确差异，暂不能确认核对。请先打开“账单360 → 合同核验”，核对分成、税率、授权期或费用条款；如自动匹配不正确，可人工锁定正确的合同合作清单。`
      )
    }
  }

  const result = await apiPost<BillLifecycle>(
    `/api/bill-lifecycle/${encodeURIComponent(billType)}/${encodeURIComponent(billId)}/transition`,
    {
      to_status: toStatus,
      reason: reason || null
    }
  )

  // Confirmation is the accounting decision point. Persist the exact contract
  // preflight that existed at that moment so later edits to a contract do not
  // rewrite the historical basis for this bill. Snapshot failure must never
  // roll back an otherwise valid bill lifecycle transition.
  if (toStatus === 'confirmed') {
    try {
      await createContractReconciliationSnapshot(billType, billId, 'confirmed')
    } catch (snapshotError) {
      console.warn('Contract reconciliation snapshot could not be saved', snapshotError)
    }
  }

  return result
}
