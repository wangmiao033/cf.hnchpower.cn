import { apiGet, apiPost } from '@/lib/api/client.ts'
import { createContractReconciliationSnapshot } from '@/lib/api/contractTerms.ts'

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
