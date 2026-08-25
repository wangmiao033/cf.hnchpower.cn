import { apiGet, apiPost } from '@/lib/api/client.ts'
import {
  createContractReconciliationSnapshot,
  getContractBillReconciliation
} from '@/lib/api/contractTerms.ts'
import type {
  ContractBillLineCheck,
  ContractBillReconciliation
} from '@/lib/api/contractTerms.ts'
import { listContractDifferenceCases } from '@/lib/api/contractDifferences.ts'
import type { ContractDifferenceCase } from '@/lib/api/contractDifferences.ts'
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

type ContractDifferenceApproval = {
  approved: boolean
  items: ContractDifferenceCase[]
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function money(value: unknown): string {
  const parsed = finiteNumber(value)
  if (parsed === null) return '-'
  return `¥${parsed.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function plainValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '未填写'
  if (typeof value === 'number') return String(Math.round(value * 10000) / 10000)
  return String(value)
}

function varianceLabel(direction: unknown): string {
  if (direction === 'under') return '少结'
  if (direction === 'over') return '多结'
  return '差额'
}

function linePrefix(gameName: unknown, settlementCycle: unknown): string {
  const game = String(gameName || '').trim() || '账单明细'
  const cycle = String(settlementCycle || '').trim()
  return cycle ? `${game}（${cycle}）` : game
}

function describeDifferenceCase(item: ContractDifferenceCase): string {
  const prefix = linePrefix(item.game_name, item.settlement_cycle)
  const expected = finiteNumber(item.expected_amount)
  const actual = finiteNumber(item.actual_amount)
  const variance = finiteNumber(item.variance_abs)
  if (expected !== null && actual !== null) {
    const tail = variance === null
      ? ''
      : `，${varianceLabel(item.variance_direction)} ${money(Math.abs(variance))}`
    return `${prefix}：合同应结 ${money(expected)}，账单实际 ${money(actual)}${tail}`
  }
  return `${prefix}：合同核验存在明确差异`
}

function describeFailedCheck(line: ContractBillLineCheck): string {
  const prefix = linePrefix(line.game_name, line.settlement_cycle)
  const amount = line.contract_amount
  if (
    amount?.status === 'fail' &&
    finiteNumber(amount.expected_amount) !== null &&
    finiteNumber(amount.actual_amount) !== null
  ) {
    const variance = finiteNumber(amount.variance_abs)
    const tail = variance === null
      ? ''
      : `，${varianceLabel(amount.variance_direction)} ${money(Math.abs(variance))}`
    return `${prefix}：合同应结 ${money(amount.expected_amount)}，账单实际 ${money(amount.actual_amount)}${tail}`
  }

  const failedChecks = (line.checks || [])
    .filter((check) => check.status === 'fail')
    .slice(0, 3)
  if (failedChecks.length) {
    const detail = failedChecks
      .map((check) => `${check.label}：账单 ${plainValue(check.bill_value)} / 合同 ${plainValue(check.contract_value)}`)
      .join('、')
    return `${prefix}：${detail}`
  }
  return `${prefix}：${line.message || '合同核验存在明确差异'}`
}

/**
 * Confirmation blocks are business validation results, not generic server errors.
 * Always surface the exact game / period / amount (or failed contract field) that
 * caused the block so finance can correct the row without opening another panel.
 */
export function buildContractDifferenceBlockedMessage(
  failCount: number,
  cases: ContractDifferenceCase[] = [],
  preflight: ContractBillReconciliation | null = null
): string {
  const count = Math.max(1, Math.trunc(Number(failCount) || 0))
  let details = cases
    .filter((item) => item.status !== 'resolved')
    .map(describeDifferenceCase)

  if (!details.length) {
    details = (preflight?.lines || [])
      .filter((line) => line.status === 'fail' || line.contract_amount?.status === 'fail')
      .map(describeFailedCheck)
  }

  const shown = details.slice(0, 3)
  const remaining = Math.max(0, count - shown.length)
  const detailText = shown.length
    ? `具体问题：${shown.join('；')}。`
    : '系统已判定存在明确合同差异，但当前响应没有返回可展示的差异字段。'
  const remainingText = remaining > 0 ? `另有 ${remaining} 条差异未展开。` : ''

  return `合同核对未通过：发现 ${count} 条明确差异。${detailText}${remainingText}请直接修改上述明细；如果这就是双方确认的特殊结算，再使用“特殊结算确认”留痕。`
}

export class ContractDifferenceBlockedError extends Error {
  contractDifferences: ContractDifferenceCase[]
  failCount: number

  constructor(message: string, contractDifferences: ContractDifferenceCase[] = [], failCount = 0) {
    super(message)
    this.name = 'ContractDifferenceBlockedError'
    this.contractDifferences = contractDifferences
    this.failCount = failCount
  }
}

async function getContractDifferenceApproval(
  billType: 'rd' | 'channel',
  billId: string,
  failCount: number
): Promise<ContractDifferenceApproval> {
  if (failCount <= 0) return { approved: true, items: [] }
  try {
    const result = await listContractDifferenceCases({ billType, billId, limit: 200 })
    const items = result.items || []
    const unresolved = items.filter((item) => item.status !== 'resolved')
    const accepted = items.filter(
      (item) => item.status === 'resolved' && item.handling_type === 'accept_difference'
    )
    return {
      approved: unresolved.length === 0 && accepted.length >= failCount,
      items
    }
  } catch (error) {
    console.warn('Contract difference approval lookup unavailable', error)
    return { approved: false, items: [] }
  }
}

export async function transitionBillLifecycle(
  billType: 'rd' | 'channel',
  billId: string,
  toStatus: string,
  reason = ''
): Promise<BillLifecycle> {
  if (toStatus === 'confirmed') {
    let preflight: ContractBillReconciliation | null = null
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
      const approval = await getContractDifferenceApproval(
        billType,
        billId,
        failCount
      )
      if (!approval.approved) {
        const unresolved = approval.items.filter((item) => item.status !== 'resolved')
        throw new ContractDifferenceBlockedError(
          buildContractDifferenceBlockedMessage(failCount, unresolved, preflight),
          unresolved.length ? unresolved : approval.items,
          failCount
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