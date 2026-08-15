/**
 * 研发对账 REST API
 */

import {
  apiDelete,
  apiGet,
  apiPost,
  apiPostMultipart,
  apiPut,
  ApiError
} from '@/lib/api/client.ts'
import type { BankTransactionRow } from '@/lib/api/bankTransaction.ts'

export type ApiReconciliationLineItemRow = {
  id: string
  reconciliation_id: string
  settlement_cycle: string | null
  game_name: string | null
  revenue: number
  discount_rate: number
  net_revenue: number
  coupon_amount: number
  test_fee: number
  extra_fee: number
  share_ratio: number
  tax_rate: number
  share_amount: number
  settlement_amount: number
  sort_order: number
  created_at?: string
}

export type ApiReconciliationRow = {
  id: string
  statement_no: string
  settlement_month: string | null
  settlement_periods?: string[]
  settlement_period_label?: string | null
  partner_id?: string | null
  partner_name: string | null
  partner_short_name?: string | null
  partner_name_snapshot?: string | null
  partner_link_status?: 'linked' | 'unlinked'
  game_name: string | null
  game_flow: number
  test_cost: number
  voucher_cost: number
  channel_fee_rate: number
  tax_rate: number
  revenue_share_rate: number
  discount_value: number
  refund_amount: number
  settlement_amount: number
  prepayment_deduction?: number
  actual_payable?: number
  status: string | null
  remark: string | null
  created_at: string
  updated_at: string
  items?: ApiReconciliationLineItemRow[]
  bank_payment_list_status?: string | null
  paid_amount?: number
  unpaid_amount?: number
  payment_status?: string
  payment_count?: number
  latest_payment_date?: string | null
}

export type ApiReconciliationPeriodSummary = {
  bill_id: string
  periods: string[]
  period_label: string
  items: ApiReconciliationLineItemRow[]
}

export type BankPaymentTransferStatus = 'pending_submit' | 'submitted' | 'paid' | 'failed'

export type ApiBankPaymentRow = {
  id: string
  reconciliation_id: string
  transaction_serial: string | null
  authorization_status: string | null
  remittance_amount: number
  remittance_purpose: string | null
  payment_remark: string | null
  is_scheduled: boolean
  payment_date: string | null
  transfer_status: string
  remitter_company: string | null
  remitter_account: string | null
  remitter_bank_name: string | null
  payee_company: string | null
  payee_account: string | null
  payee_bank_name: string | null
  submitter_user_id: string | null
  first_approver_user_id: string | null
  first_approval_at: string | null
  bank_feedback: string | null
  instruction_channel: string | null
  is_personal_payee: boolean
  created_at: string
  updated_at: string
}

export type ApiBankPaymentAttachmentRow = {
  id: string
  bank_payment_id: string
  file_name: string
  file_url: string
  file_type: string | null
  created_at: string
}

export type BankPaymentUpsertPayload = {
  transaction_serial?: string | null
  authorization_status?: string | null
  remittance_amount: number
  remittance_purpose?: string | null
  payment_remark?: string | null
  is_scheduled: boolean
  payment_date?: string | null
  transfer_status: string
  remitter_company?: string | null
  remitter_account?: string | null
  remitter_bank_name?: string | null
  payee_company?: string | null
  payee_account?: string | null
  payee_bank_name?: string | null
  submitter_user_id?: string | null
  first_approver_user_id?: string | null
  first_approval_at?: string | null
  bank_feedback?: string | null
  instruction_channel?: string | null
  is_personal_payee: boolean
}

export type ReconciliationListResponse = {
  items: ApiReconciliationRow[]
  total: number
}

export type ReconciliationLineItemPayload = {
  settlement_cycle?: string | null
  game_name: string | null
  revenue: number
  discount_rate: number
  coupon_amount: number
  test_fee: number
  extra_fee: number
  share_ratio: number
  tax_rate: number
  sort_order: number
}

export type ReconciliationCreatePayload = {
  statement_no?: string | null
  settlement_month?: string | null
  partner_id?: string | null
  partner_name?: string | null
  game_name?: string | null
  game_flow: number
  test_cost: number
  voucher_cost: number
  channel_fee_rate: number
  tax_rate: number
  revenue_share_rate: number
  discount_value: number
  refund_amount: number
  settlement_amount: number
  status?: string | null
  remark?: string | null
  items?: ReconciliationLineItemPayload[]
}

export type ReconciliationUpdatePayload = Partial<ReconciliationCreatePayload>

const PATH = '/api/reconciliation'
const PERIOD_PATH = '/api/reconciliation-periods'

async function attachPeriodMetadata(
  response: ReconciliationListResponse
): Promise<ReconciliationListResponse> {
  if (!Array.isArray(response.items) || response.items.length === 0) return response
  const ids = response.items.map((row) => row.id).filter(Boolean)
  if (ids.length === 0) return response

  try {
    const periods = await apiGet<{ items: ApiReconciliationPeriodSummary[]; total: number }>(
      `${PERIOD_PATH}?ids=${encodeURIComponent(ids.join(','))}`
    )
    const periodMap = new Map((periods.items || []).map((item) => [String(item.bill_id), item]))
    return {
      ...response,
      items: response.items.map((row) => {
        const summary = periodMap.get(String(row.id))
        if (!summary) return row
        return {
          ...row,
          settlement_periods: summary.periods || [],
          settlement_period_label: summary.period_label || row.settlement_month,
          items: summary.items || []
        }
      })
    }
  } catch (error) {
    console.warn('研发账单周期明细读取失败，继续使用主表兼容字段。', error)
    return response
  }
}

export async function listReconciliationRecords(params?: {
  search?: string
  settlement_month?: string
  partner_name?: string
  game_name?: string
  status?: string
  limit?: number
  offset?: number
}): Promise<ReconciliationListResponse> {
  const q = new URLSearchParams()
  if (params?.search) q.set('search', params.search)
  if (params?.settlement_month) q.set('settlement_month', params.settlement_month)
  if (params?.partner_name) q.set('partner_name', params.partner_name)
  if (params?.game_name) q.set('game_name', params.game_name)
  if (params?.status) q.set('status', params.status)
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString()
  const response = await apiGet<ReconciliationListResponse>(`${PATH}${qs ? `?${qs}` : ''}`)
  return attachPeriodMetadata(response)
}

export function getReconciliationRecord(id: string): Promise<ApiReconciliationRow> {
  return apiGet<ApiReconciliationRow>(`${PATH}/${encodeURIComponent(id)}`)
}

export function createReconciliationRecord(
  payload: ReconciliationCreatePayload
): Promise<ApiReconciliationRow> {
  return apiPost<ApiReconciliationRow>(PATH, payload)
}

export function updateReconciliationRecord(
  id: string,
  payload: ReconciliationUpdatePayload
): Promise<ApiReconciliationRow> {
  return apiPut<ApiReconciliationRow>(`${PATH}/${encodeURIComponent(id)}`, payload)
}

export function deleteReconciliationRecord(id: string): Promise<void> {
  return apiDelete(`${PATH}/${encodeURIComponent(id)}`)
}

export function listReconciliationLinkedBankPayments(
  reconciliationId: string
): Promise<{ items: BankTransactionRow[]; total: number }> {
  return apiGet<{ items: BankTransactionRow[]; total: number }>(
    `${PATH}/${encodeURIComponent(reconciliationId)}/payments`
  )
}

export async function getReconciliationBankPayment(
  reconciliationId: string
): Promise<ApiBankPaymentRow | null> {
  try {
    return await apiGet<ApiBankPaymentRow | null>(
      `${PATH}/${encodeURIComponent(reconciliationId)}/bank-payment`
    )
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

export function upsertReconciliationBankPayment(
  reconciliationId: string,
  payload: BankPaymentUpsertPayload
): Promise<ApiBankPaymentRow> {
  return apiPut<ApiBankPaymentRow>(
    `${PATH}/${encodeURIComponent(reconciliationId)}/bank-payment`,
    payload
  )
}

export function listBankPaymentAttachments(
  reconciliationId: string
): Promise<{ items: ApiBankPaymentAttachmentRow[] }> {
  return apiGet<{ items: ApiBankPaymentAttachmentRow[] }>(
    `${PATH}/${encodeURIComponent(reconciliationId)}/bank-payment/attachments`
  )
}

export function uploadBankPaymentAttachment(
  reconciliationId: string,
  file: File
): Promise<ApiBankPaymentAttachmentRow> {
  const fd = new FormData()
  fd.append('file', file)
  return apiPostMultipart<ApiBankPaymentAttachmentRow>(
    `${PATH}/${encodeURIComponent(reconciliationId)}/bank-payment/attachments`,
    fd
  )
}

export function deleteBankPaymentAttachment(
  reconciliationId: string,
  attachmentId: string
): Promise<void> {
  return apiDelete(
    `${PATH}/${encodeURIComponent(reconciliationId)}/bank-payment/attachments/${encodeURIComponent(attachmentId)}`
  )
}

export function getReconciliationRecordId(
  record: Record<string, unknown> | null | undefined
): string {
  if (record == null) return ''
  const v = record.id
  if (v === undefined || v === null || v === '') return ''
  return String(v)
}

function finiteNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || String(value).trim() === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function apiLineToFrontend(line: ApiReconciliationLineItemRow, parentSettlementMonth?: string | null) {
  return {
    id: line.id,
    settlementCycle:
      line.settlement_cycle != null && String(line.settlement_cycle).trim() !== ''
        ? String(line.settlement_cycle)
        : parentSettlementMonth || '',
    gameName: line.game_name != null ? String(line.game_name) : '',
    revenue: String(line.revenue ?? 0),
    discountRate: String(line.discount_rate ?? 1),
    netRevenue: Number(line.net_revenue ?? 0),
    couponAmount: String(line.coupon_amount ?? 0),
    testFee: String(line.test_fee ?? 0),
    extraFee: String(line.extra_fee ?? 0),
    shareRatio: String(line.share_ratio ?? 0),
    taxRate: String(line.tax_rate ?? 0),
    shareAmount: Number(line.share_amount ?? 0),
    settlementAmount: Number(line.settlement_amount ?? 0),
    sortOrder: line.sort_order ?? 0
  }
}

function legacyItemsFromApiRow(row: ApiReconciliationRow) {
  return [
    {
      id: `legacy-${row.id}`,
      settlementCycle: row.settlement_month ?? '',
      gameName: row.game_name != null ? String(row.game_name) : '',
      revenue: String(row.game_flow ?? 0),
      discountRate: String(row.discount_value ?? 1),
      netRevenue: Number(row.game_flow ?? 0) * Number(row.discount_value ?? 1),
      couponAmount: String(row.voucher_cost ?? 0),
      testFee: String(row.test_cost ?? 0),
      extraFee: String(row.refund_amount ?? 0),
      shareRatio: String(row.revenue_share_rate ?? 0),
      taxRate: String(row.tax_rate ?? 0),
      shareAmount: 0,
      settlementAmount: Number(row.settlement_amount ?? 0),
      sortOrder: 0
    }
  ]
}

export function apiRowToFrontend(row: ApiReconciliationRow): Record<string, unknown> {
  const idStr = row.id != null && String(row.id).trim() !== '' ? String(row.id) : ''
  const rawItems = row.items
  const items =
    Array.isArray(rawItems) && rawItems.length > 0
      ? rawItems.map((line) => apiLineToFrontend(line, row.settlement_month))
      : legacyItemsFromApiRow(row)
  return {
    id: idStr,
    settlementMonth: row.settlement_month ?? '',
    settlementPeriods: row.settlement_periods ?? [],
    settlementPeriodLabel: row.settlement_period_label ?? '',
    settlementNumber: row.statement_no ?? '',
    partnerId: row.partner_id ?? '',
    partner: row.partner_name ?? '',
    partnerShortName: row.partner_short_name ?? '',
    partnerLinkStatus: row.partner_link_status ?? (row.partner_id ? 'linked' : 'unlinked'),
    game: row.game_name ?? '',
    gameFlow: row.game_flow != null ? String(row.game_flow) : '0',
    testingFee: row.test_cost != null ? String(row.test_cost) : '0',
    voucher: row.voucher_cost != null ? String(row.voucher_cost) : '0',
    channelFeeRate: row.channel_fee_rate != null ? String(row.channel_fee_rate) : '0',
    taxPoint: row.tax_rate != null ? String(row.tax_rate) : '0',
    revenueShareRatio: row.revenue_share_rate != null ? String(row.revenue_share_rate) : '15',
    discount: row.discount_value != null ? String(row.discount_value) : '1',
    refund: row.refund_amount != null ? String(row.refund_amount) : '0',
    settlementAmount:
      row.settlement_amount != null ? Number(row.settlement_amount).toFixed(2) : '0.00',
    prepaymentDeduction:
      row.prepayment_deduction != null ? Number(row.prepayment_deduction).toFixed(2) : '0.00',
    actualPayable:
      row.actual_payable != null
        ? Number(row.actual_payable).toFixed(2)
        : Math.max(0, Number(row.settlement_amount || 0) - Number(row.prepayment_deduction || 0)).toFixed(2),
    status: row.status || 'pending',
    memo: row.remark != null ? String(row.remark) : '',
    items,
    paidAmount:
      row.paid_amount != null && Number.isFinite(Number(row.paid_amount))
        ? Number(row.paid_amount).toFixed(2)
        : '0.00',
    unpaidAmount:
      row.unpaid_amount != null && Number.isFinite(Number(row.unpaid_amount))
        ? Number(row.unpaid_amount).toFixed(2)
        : '0.00',
    paymentStatus: row.payment_status != null ? String(row.payment_status) : '未付款',
    paymentCount:
      row.payment_count != null && Number.isFinite(Number(row.payment_count))
        ? Number(row.payment_count)
        : 0,
    latestPaymentDate: row.latest_payment_date != null ? String(row.latest_payment_date) : ''
  }
}

export function frontendRecordToApiPayload(
  record: Record<string, unknown>,
  options?: { includeStatementNo?: boolean }
): ReconciliationCreatePayload {
  const includeNo = options?.includeStatementNo !== false
  const settlementNumber = (record.settlementNumber as string) || ''
  const recItems = record.items as Array<Record<string, unknown>> | undefined
  const items: ReconciliationLineItemPayload[] | undefined =
    Array.isArray(recItems) && recItems.length > 0
      ? recItems.map((line, idx) => ({
          settlement_cycle:
            line.settlementCycle != null && String(line.settlementCycle).trim() !== ''
              ? String(line.settlementCycle).trim()
              : (record.settlementMonth as string) || null,
          game_name:
            line.gameName != null && String(line.gameName).trim() !== ''
              ? String(line.gameName).trim()
              : null,
          revenue: finiteNumber(line.revenue),
          discount_rate: finiteNumber(line.discountRate, 1),
          coupon_amount: finiteNumber(line.couponAmount),
          test_fee: finiteNumber(line.testFee),
          extra_fee: finiteNumber(line.extraFee),
          share_ratio: finiteNumber(line.shareRatio),
          tax_rate: finiteNumber(line.taxRate),
          sort_order: finiteNumber(line.sortOrder, idx)
        }))
      : undefined
  return {
    ...(includeNo ? { statement_no: settlementNumber || null } : {}),
    settlement_month: (record.settlementMonth as string) || null,
    partner_id: (record.partnerId as string) || null,
    partner_name: (record.partner as string) || null,
    game_name: (record.game as string) || null,
    game_flow: finiteNumber(record.gameFlow),
    test_cost: finiteNumber(record.testingFee),
    voucher_cost: finiteNumber(record.voucher),
    channel_fee_rate: finiteNumber(record.channelFeeRate),
    tax_rate: finiteNumber(record.taxPoint),
    revenue_share_rate: finiteNumber(record.revenueShareRatio),
    discount_value: finiteNumber(record.discount, 1),
    refund_amount: finiteNumber(record.refund),
    settlement_amount: finiteNumber(record.settlementAmount),
    status: (record.status as string) || 'pending',
    remark: record.memo != null && record.memo !== '' ? String(record.memo) : null,
    ...(items !== undefined ? { items } : {})
  }
}
