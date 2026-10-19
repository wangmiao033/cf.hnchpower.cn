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

/**
 * Explicit ADMIN action for a previously recorded <= ¥0.50 channel contract
 * difference. Server validates settled identity/authorization, actual saved
 * amounts, and approved cases; it atomically logs the reason and locks the bill.
 * Never call the normal transition's optimistic preflight bypass for this.
 */
export async function confirmApprovedChannelSmallVariance(
  billId: string,
  reason: string
): Promise<BillLifecycle> {
  const lifecycle = await apiPost<BillLifecycle>(
    '/api/bill-lifecycle/channel/' + encodeURIComponent(billId) + '/confirm-small-variance',
    { reason }
  )
  // Align with normal bill confirmation: retain historical contract evidence
  // even if the independently audited small-variance confirmation succeeded.
  try {
    await createContractReconciliationSnapshot('channel', billId, 'confirmed')
  } catch (snapshotError) {
    console.warn('Small-variance contract snapshot could not be saved', snapshotError)
  }
  return lifecycle
}


type ContractDifferenceApproval = {
  approved: boolean
  items: ContractDifferenceCase[]
}

export type OfficialStatementLine = {
  line_id: string
  game_name: string
  settlement_cycle: string
  system_amount: number
  platform_amount: number
}

export function getChannelOfficialStatementPolicy(billId: string) {
  return apiGet<{ policy: { code: string; partner_id: string; partner_name: string } | null }>(
    '/api/bill-lifecycle/channel/' + encodeURIComponent(billId) + '/official-statement-policy'
  )
}

export type ChannelPlatformVarianceReview = {
  policyCode?: string
  partnerId?: string
  officialLines?: OfficialStatementLine[]
  reviewKind?: 'small' | 'documented'
  absoluteLineDifferenceCents?: number
  systemAmount: number
  platformAmount: number
  settlementAmount: number
  differenceCents: number
  lineIds: string[]
}

/** Audited platform-amount approval: exact persisted amounts and line IDs are part of
 * the request so a changed bill cannot be approved from a stale review screen.
 */
export async function confirmReviewedChannelPlatformVariance(
  billId: string,
  reason: string,
  review: ChannelPlatformVarianceReview,
  evidenceAttachmentId = '',
  evidenceConfirmed = false,
  officialLineConfirmations: OfficialStatementLine[] = [],
  officialReason = ''
): Promise<BillLifecycle> {
  const official = review.policyCode === 'honor_official_statement_v1'
  // This existing endpoint generates the snapshot on the contract server; the
  // backend independently verifies it, rather than trusting client preflight.
  const snapshot = official
    ? await createContractReconciliationSnapshot('channel', billId, review.policyCode)
    : null
  const lifecycle = await apiPost<BillLifecycle>(
    '/api/bill-lifecycle/channel/' + encodeURIComponent(billId) + '/confirm-platform-variance',
    {
      reason,
      expected_system_amount: review.systemAmount,
      expected_platform_amount: review.platformAmount,
      expected_settlement_amount: review.settlementAmount,
      expected_signed_difference_cents: review.differenceCents,
      expected_line_ids: review.lineIds,
      evidence_attachment_id: evidenceAttachmentId || null,
      evidence_confirmed: evidenceConfirmed,
      ...(official ? {
        official_statement_policy: review.policyCode,
        expected_partner_id: review.partnerId,
        official_statement_reason: officialReason,
        official_line_confirmations: officialLineConfirmations,
        contract_snapshot_id: snapshot?.id
      } : {})
    }
  )
  try {
    await createContractReconciliationSnapshot('channel', billId, 'confirmed')
  } catch (error) {
    console.warn('Confirmed platform-tail contract snapshot could not be saved', error)
  }
  return lifecycle
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const PLATFORM_TAIL_ALLOWED_FINANCIAL_CHECKS = new Set([
  'share_rate',
  'channel_fee_rate',
  'tax_rate',
  'testing_fee',
  'contract_standard_settlement'
])

const BLOCKED_AUTHORIZATION = new Set([
  'expired',
  'out_of_range',
  'invalid',
  'not_covered'
])

/** Line fails only on share/fee/tax metadata while contract amount already matches the bill. */
export function isRateOnlyLineContractFailure(line: ContractBillLineCheck): boolean {
  const amount = line.contract_amount
  const expected = finiteNumber(amount?.expected_amount)
  const actual = finiteNumber(amount?.actual_amount)
  const amountAligned = amount?.status === 'pass' || (
    expected !== null &&
    actual !== null &&
    Math.round(expected * 100) === Math.round(actual * 100)
  )
  if (!amountAligned) return false
  const failing = (line.checks || []).filter((check) => check?.status === 'fail')
  if (!failing.length) return false
  return failing.every((check) => PLATFORM_TAIL_ALLOWED_FINANCIAL_CHECKS.has(String(check.key || '')))
}

export function isRateOnlyUnresolvedContractCase(item: ContractDifferenceCase): boolean {
  if (item.status === 'resolved') return false
  const expected = finiteNumber(item.expected_amount)
  const actual = finiteNumber(item.actual_amount)
  if (
    expected === null ||
    actual === null ||
    Math.round(expected * 100) !== Math.round(actual * 100)
  ) {
    return false
  }
  const snapshot = item.source_snapshot
  if (snapshot && typeof snapshot === 'object') {
    const match = (snapshot as { match?: { authorization_status?: string } }).match
    const authorization = String(match?.authorization_status || '').toLowerCase()
    if (BLOCKED_AUTHORIZATION.has(authorization)) return false
    const checks = Array.isArray((snapshot as { checks?: Array<{ key?: string; status?: string }> }).checks)
      ? (snapshot as { checks?: Array<{ key?: string; status?: string }> }).checks || []
      : []
    let sawFinancialFail = false
    for (const check of checks) {
      if (check?.status !== 'fail') continue
      const key = String(check.key || '')
      if (!PLATFORM_TAIL_ALLOWED_FINANCIAL_CHECKS.has(key)) return false
      sawFinancialFail = true
    }
    if (checks.length) return sawFinancialFail
  }
  const variance = finiteNumber(item.variance_abs)
  if (variance !== null && Math.round(variance * 100) !== 0) return false
  const difference = finiteNumber(item.difference_amount)
  if (difference !== null && Math.round(difference * 100) !== 0) return false
  return true
}

export function countBlockingContractFailures(preflight: ContractBillReconciliation): number {
  const billFails = (preflight.bill_checks || []).filter((check) => check.status === 'fail').length
  const lineFails = (preflight.lines || []).filter((line) => {
    if (line.status !== 'fail' && line.contract_amount?.status !== 'fail') return false
    if (isRateOnlyLineContractFailure(line)) return false
    return true
  }).length
  return billFails + lineFails
}

/** A manual platform-amount exception does NOT override contract identity, authorization
 * or unresolved approval. Unlike the normal flow, contract service unavailability
 * is a hard stop for this exceptional confirmation.
 */
export async function assertContractReadyForPlatformTail(billId: string, review: ChannelPlatformVarianceReview | null = null): Promise<void> {
  let preflight: ContractBillReconciliation
  try {
    preflight = await getContractBillReconciliation('channel', billId)
  } catch (error) {
    throw new Error('合同核验服务暂时不可用，无法安全确认平台尾差，请稍后重试')
  }
  if (!Array.isArray(preflight?.lines) || preflight.lines.length === 0) {
    throw new Error('合同核验未返回完整的游戏明细，暂不能确认平台尾差')
  }
  if (review?.policyCode === 'honor_official_statement_v1') {
    const current = new Map((review.officialLines || []).map(line => [line.line_id, line]))
    const invalid = (preflight.lines.length !== current.size)
      || (preflight.bill_checks || []).some(check => check.status === 'fail')
      || preflight.lines.some(line => {
        const saved = current.get(String(line.line_id))
        return !saved || line.game_name !== saved.game_name || line.settlement_cycle !== saved.settlement_cycle
          || !line.match?.contract_id || !line.match?.access_item_id || line.match.confidence !== 'high'
          || !(line.checks || []).some(check => check.key === 'authorization' && check.status === 'pass')
          || (line.checks || []).some(check => check.status === 'fail' && check.key !== 'contract_standard_settlement')
          || !line.contract_amount?.supported || !line.contract_amount?.deterministic
          || finiteNumber(line.contract_amount?.actual_amount) === null
          || Math.round(Number(line.contract_amount?.actual_amount) * 100) !== Math.round(saved.platform_amount * 100)
      })
    if (invalid) throw new Error('合同主体、游戏、授权期或费率未通过核验；荣耀官方金额规则只处理金额比较差异')
    return
  }
  const hardBill = (preflight.bill_checks || []).find(check => check.status === 'fail')
  const hardLine = preflight.lines.flatMap(line => line.checks || []).find(check =>
    check.status === 'fail' && !PLATFORM_TAIL_ALLOWED_FINANCIAL_CHECKS.has(String(check.key || ''))
  )
  if (hardBill || hardLine) {
    throw new Error('仍存在合同身份、授权范围或账单级核验失败，不能按金额尾差放行')
  }
  const blockingFailCount = countBlockingContractFailures(preflight)
  if (blockingFailCount > 0) {
    const approval = await getContractDifferenceApproval('channel', billId, blockingFailCount)
    if (!approval.approved) {
      const unresolved = approval.items.filter(item => item.status !== 'resolved')
      const blockingUnresolved = unresolved.filter((item) => !isRateOnlyUnresolvedContractCase(item))
      throw new ContractDifferenceBlockedError(
        buildContractDifferenceBlockedMessage(blockingFailCount, blockingUnresolved, preflight),
        blockingUnresolved.length ? blockingUnresolved : approval.items,
        blockingFailCount
      )
    }
  }
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

type ContractFieldForDisplay = {
  key?: string
  label?: string
  status?: string
  bill_value?: unknown
  contract_value?: unknown
}

function failedContractFields(checks: ContractFieldForDisplay[] | undefined): string[] {
  return (checks || [])
    .filter((check) => check?.status === 'fail' && check.key !== 'contract_standard_settlement')
    .slice(0, 3)
    .map((check) =>
      (check.label || check.key || '合同条款') + '：账单 ' + plainValue(check.bill_value) +
      ' / 合同 ' + plainValue(check.contract_value)
    )
}

function describeDifferenceCase(item: ContractDifferenceCase, currentLine?: ContractBillLineCheck): string {
  const prefix = linePrefix(item.game_name, item.settlement_cycle)
  const expected = finiteNumber(item.expected_amount)
  const actual = finiteNumber(item.actual_amount)
  const variance = finiteNumber(item.variance_abs)
  // A rate-only mismatch can have an exactly zero amount difference. Prefer the
  // latest verified fields; fall back to the original case's audit snapshot.
  const failedFields = failedContractFields(
    currentLine ? currentLine.checks : item.source_snapshot?.checks
  )
  if (failedFields.length) {
    const amountText = expected !== null && actual !== null
      ? Math.round(expected * 100) === Math.round(actual * 100)
        ? '；金额一致 ' + money(actual)
        : '；合同应结 ' + money(expected) + '，账单实际 ' + money(actual)
      : ''
    return prefix + '：' + failedFields.join('、') + amountText
  }
  if (expected !== null && actual !== null) {
    if (Math.round(expected * 100) === Math.round(actual * 100)) {
      return prefix + '：合同应结 ' + money(expected) + '，账单实际 ' + money(actual) +
        '，金额一致；仍有未关闭的合同差异，请查看合同差异处理记录'
    }
    const tail = variance === null
      ? ''
      : '，' + varianceLabel(item.variance_direction) + ' ' + money(Math.abs(variance))
    return prefix + '：合同应结 ' + money(expected) + '，账单实际 ' + money(actual) + tail
  }
  return prefix + '：合同核验存在明确差异'
}

function describeFailedCheck(line: ContractBillLineCheck): string {
  const prefix = linePrefix(line.game_name, line.settlement_cycle)
  const amount = line.contract_amount
  const failedFields = failedContractFields(line.checks)
  if (
    amount?.status === 'fail' &&
    finiteNumber(amount.expected_amount) !== null &&
    finiteNumber(amount.actual_amount) !== null
  ) {
    const variance = finiteNumber(amount.variance_abs)
    const tail = variance === null
      ? ''
      : '，' + varianceLabel(amount.variance_direction) + ' ' + money(Math.abs(variance))
    const fieldText = failedFields.length ? '；' + failedFields.join('、') : ''
    return prefix + '：合同应结 ' + money(amount.expected_amount) +
      '，账单实际 ' + money(amount.actual_amount) + tail + fieldText
  }
  if (failedFields.length) return prefix + '：' + failedFields.join('、')
  return prefix + '：' + (line.message || '合同核验存在明确差异')
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
  const currentLines = new Map(
    (preflight?.lines || []).map((line) => [String(line.line_id || ''), line])
  )
  const unresolvedCases = cases.filter((item) => item.status !== 'resolved')
  let details = unresolvedCases.map((item) =>
    describeDifferenceCase(item, currentLines.get(String(item.line_id || '')))
  )

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

  const amountEqualCases = unresolvedCases.length > 0 && unresolvedCases.every((item) =>
    finiteNumber(item.expected_amount) !== null &&
    finiteNumber(item.actual_amount) !== null &&
    Math.round(Number(item.expected_amount) * 100) === Math.round(Number(item.actual_amount) * 100)
  )
  const actionText = amountEqualCases
    ? '请核对合同条款与账单规则；合同记录有误时应核实更正，真实特殊结算则使用“特殊结算确认”留痕。'
    : '请直接修改上述明细；如果这就是双方确认的特殊结算，再使用“特殊结算确认”留痕。'

  return `合同核对未通过：发现 ${count} 条明确差异。${detailText}${remainingText}${actionText}`
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