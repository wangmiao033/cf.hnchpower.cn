import { apiGet, apiPost } from '@/lib/api/client.ts'
import {
  createContractReconciliationSnapshot,
  getContractBillReconciliation
} from '@/lib/api/contractTerms.ts'
import { listContractDifferenceCases } from '@/lib/api/contractDifferences.ts'
import type { ChannelCumulativeBillCondition } from '@/lib/api/channelCumulativeSettlement.ts'

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
  payment_phase: 'unpaid' | 'partial' | 'paid' | 'deferred' | string
  payment_label: string
  bill_amount: number
  paid_amount: number
  invoice_coverage_status: 'none' | 'partial' | 'complete' | 'over' | 'deferred' | string
  invoice_coverage_percent: number
  invoice_allocated_amount: number
  invoice_remaining_amount: number
  settlement_condition?: ChannelCumulativeBillCondition | null
  transitions: BillTransitionOption[]
}

export function getBillLifecycle(
  billType: 'rd' | 'channel',
  billId: string
): Promise<BillLifecycle> {
  return apiGet(`/api/bill-lifecycle/${encodeURIComponent(billType)}/${encodeURIComponent(billId)}`)
}

async function hasApprovedContractDifferenceOverride(
  billType: 'rd' | 'channel',
  billId: string,
  failCount: number
): Promise<boolean> {
  if (failCount <= 0) return true
  try {
    const result = await listContractDifferenceCases({ billType, billId, limit: 200 })
    const items = result.items || []
    const unresolved = items.filter((item) => item.status !== 'resolved')
    const accepted = items.filter(
      (item) => item.status === 'resolved' && item.handling_type === 'accept_difference'
    )
    return unresolved.length === 0 && accepted.length >= failCount
  } catch (error) {
    console.warn('Contract difference approval lookup unavailable', error)
    return false
  }
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
      const approvedOverride = await hasApprovedContractDifferenceOverride(
        billType,
        billId,
        failCount
      )
      if (!approvedOverride) {
        throw new Error(
          `合同核验发现 ${failCount} 条明确差异，暂不能确认核对。可在当前页面“合同差异处理”中选择“特殊结算确认”并留痕，或前往“账单360 → 合同核验”修正合同匹配/账单数据。`
        )
      }
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