/** 渠道对账 REST API（主表 + 明细 items） */
import { apiDelete, apiGet, apiPost, apiPostMultipart, apiPut } from '@/lib/api/client.ts'
import { getChannelBillNumber } from '@/utils/channelBillNumber.js'

export type ApiChannelLineItem = {
  id: string; channel_record_id: string; sort_order: number; settlement_cycle: string | null; game_name: string | null;
  billing_flow: number; discount_factor: number; voucher_cost: number; no_worry_cost: number; refund_cost: number; test_cost: number; welfare_cost: number; coin_cost: number;
  share_rate: number; billing_amount: number; share_amount: number; tax_rate: number; gateway_cost: number;
  platform_settlement_amount: number | null; system_settlement_amount: number; settlement_difference: number | null; validation_status: string; settlement_amount: number;
  created_at: string; updated_at: string
}

export type ApiChannelRow = {
  id: string; statement_no: string | null; channel_name: string | null; partner_name: string | null; game_name: string | null; settlement_month: string | null; start_date: string | null; end_date: string | null;
  billing_flow: number; voucher_cost: number; no_worry_cost: number; refund_cost: number; test_cost: number; welfare_cost: number; coin_cost: number; share_rate: number; billing_amount: number; share_amount: number; tax_rate: number; gateway_cost: number; settlement_amount: number;
  received_amount: number; receipt_status: string; status: string | null; remark: string | null; server_cost: number | null; discount_type: string | null; channel_fee_rate: number | null; dev_share_rate: number | null; profit_rate: number | null;
  settlement_rule_code: string; channel_fee_mode: string; tax_mode: string; validation_tolerance: number; system_settlement_amount: number; platform_settlement_amount: number | null; settlement_difference: number | null; validation_status: string;
  created_at: string; updated_at: string; items?: ApiChannelLineItem[]
}

export type ChannelListResponse = { items: ApiChannelRow[]; total: number }
export type ChannelLinePayload = {
  settlement_cycle?: string | null; game_name?: string | null; billing_flow: number; discount_factor: number; voucher_cost: number; no_worry_cost: number; refund_cost: number; test_cost: number; welfare_cost: number; coin_cost: number;
  share_rate: number; billing_amount: number; share_amount: number; tax_rate: number; gateway_cost: number; platform_settlement_amount?: number | null; system_settlement_amount?: number; settlement_difference?: number | null; validation_status?: string; settlement_amount: number
}
export type ChannelRecordPayload = {
  statement_no?: string | null; channel_name?: string | null; partner_name?: string | null; settlement_month?: string | null; start_date?: string | null; end_date?: string | null; remark?: string | null; status?: string | null; server_cost?: number | null; discount_type?: string | null; channel_fee_rate?: number | null; dev_share_rate?: number | null; profit_rate?: number | null;
  settlement_rule_code?: string; channel_fee_mode?: string; tax_mode?: string; validation_tolerance?: number; items: ChannelLinePayload[]
}
export type ChannelRecordUpdatePayload = Partial<Omit<ChannelRecordPayload, 'items'>> & { items?: ChannelLinePayload[] }
const PATH = '/api/channel-records'

export function listChannelRecords(params?: { search?: string; settlement_month?: string; channel_name?: string; game_name?: string; status?: string; limit?: number; offset?: number }): Promise<ChannelListResponse> {
  const q = new URLSearchParams(); if (params?.search) q.set('search', params.search); if (params?.settlement_month) q.set('settlement_month', params.settlement_month); if (params?.channel_name) q.set('channel_name', params.channel_name); if (params?.game_name) q.set('game_name', params.game_name); if (params?.status) q.set('status', params.status); if (params?.limit != null) q.set('limit', String(params.limit)); if (params?.offset != null) q.set('offset', String(params.offset)); const qs = q.toString(); return apiGet<ChannelListResponse>(`${PATH}${qs ? `?${qs}` : ''}`)
}
export function getChannelRecord(id: string): Promise<ApiChannelRow> { return apiGet<ApiChannelRow>(`${PATH}/${encodeURIComponent(id)}`) }
export function createChannelRecord(payload: ChannelRecordPayload): Promise<ApiChannelRow> { return apiPost<ApiChannelRow>(PATH, payload) }
export function updateChannelRecord(id: string, payload: ChannelRecordUpdatePayload): Promise<ApiChannelRow> { return apiPut<ApiChannelRow>(`${PATH}/${encodeURIComponent(id)}`, payload) }
export function deleteChannelRecord(id: string): Promise<void> { return apiDelete(`${PATH}/${encodeURIComponent(id)}`) }

export type ChannelReceiptPayload = { amount: number; receipt_date?: string | null; bank_account?: string | null; remark?: string | null; attachment_url?: string | null }
export function uploadChannelReceiptAttachment(file: File): Promise<{ url: string }> { const fd = new FormData(); fd.append('file', file); return apiPostMultipart<{ url: string }>(`${PATH}/receipt-attachment`, fd) }
export function createChannelReceipt(recordId: string, body: ChannelReceiptPayload): Promise<ApiChannelRow> { return apiPost<ApiChannelRow>(`${PATH}/${encodeURIComponent(recordId)}/receipts`, body) }
export type ApiChannelReceipt = { id: string; channel_record_id: string; amount: number; receipt_date: string | null; bank_account: string | null; remark: string | null; attachment_url: string | null; created_at: string }
export function listChannelReceipts(recordId: string): Promise<{ items: ApiChannelReceipt[] }> { return apiGet(`${PATH}/${encodeURIComponent(recordId)}/receipts`) }
export function deleteChannelReceipt(recordId: string, receiptId: string): Promise<void> { return apiDelete(`${PATH}/${encodeURIComponent(recordId)}/receipts/${encodeURIComponent(receiptId)}`) }

function numOrNull(v: unknown): number | null { if (v === undefined || v === null || v === '') return null; const n = typeof v === 'number' ? v : parseFloat(String(v)); return Number.isFinite(n) ? n : null }
function apiLineToFrontend(row: ApiChannelLineItem): Record<string, unknown> {
  return { id: String(row.id ?? ''), channelRecordId: row.channel_record_id, sortOrder: row.sort_order, settlementCycle: row.settlement_cycle ?? '', gameName: row.game_name ?? '', flow: row.billing_flow, discountFactor: row.discount_factor ?? 1, voucherCost: row.voucher_cost, noWorryCost: row.no_worry_cost, refundCost: row.refund_cost, testCost: row.test_cost, welfareCost: row.welfare_cost, coinCost: row.coin_cost ?? 0, shareRate: row.share_rate, billingAmount: row.billing_amount, shareAmount: row.share_amount, taxRate: row.tax_rate, gatewayCost: row.gateway_cost, platformSettlementAmount: row.platform_settlement_amount, systemSettlementAmount: row.system_settlement_amount, settlementDifference: row.settlement_difference, validationStatus: row.validation_status, settlementAmount: row.settlement_amount }
}
function frontendLineToPayload(line: Record<string, unknown>): ChannelLinePayload {
  const df = parseFloat(String(line.discountFactor ?? 1)); const discount_factor = Number.isFinite(df) && df > 0 ? df : 1
  return { settlement_cycle: line.settlementCycle != null && String(line.settlementCycle).trim() ? String(line.settlementCycle).trim() : null, game_name: (line.gameName as string) || null, billing_flow: Number(line.flow || 0), discount_factor, voucher_cost: Number(line.voucherCost || 0), no_worry_cost: Number(line.noWorryCost || 0), refund_cost: Number(line.refundCost || 0), test_cost: Number(line.testCost || 0), welfare_cost: Number(line.welfareCost || 0), coin_cost: Number(line.coinCost || 0), share_rate: Number(line.shareRate || 0), billing_amount: Number(line.billingAmount || 0), share_amount: Number(line.shareAmount || 0), tax_rate: Number(line.taxRate || 0), gateway_cost: Number(line.gatewayCost || 0), platform_settlement_amount: numOrNull(line.platformSettlementAmount), system_settlement_amount: Number(line.systemSettlementAmount || 0), settlement_difference: numOrNull(line.settlementDifference), validation_status: String(line.validationStatus || 'unvalidated'), settlement_amount: Number(line.settlementAmount || 0) }
}

export function apiChannelRowToFrontend(row: ApiChannelRow): Record<string, unknown> {
  const items = (row.items ?? []).map(apiLineToFrontend)
  const record = { id: String(row.id ?? ''), statementNo: row.statement_no ?? '', createdAt: row.created_at, channelName: row.channel_name ?? '', partnerName: row.partner_name ?? '', gameName: row.game_name ?? '', settlementMonth: row.settlement_month ?? '', startDate: row.start_date ?? '', endDate: row.end_date ?? '', flow: row.billing_flow, voucherCost: row.voucher_cost, noWorryCost: row.no_worry_cost, refundCost: row.refund_cost, testCost: row.test_cost, welfareCost: row.welfare_cost, coinCost: row.coin_cost ?? 0, shareRate: row.share_rate, billingAmount: row.billing_amount, shareAmount: row.share_amount, taxRate: row.tax_rate, gatewayCost: row.gateway_cost, settlementAmount: row.settlement_amount, receivedAmount: row.received_amount ?? 0, receiptStatus: row.receipt_status ?? 'unpaid', status: row.status || 'pending', remark: row.remark ?? '', serverCost: row.server_cost, discountType: row.discount_type ?? '', channelFeeRate: row.channel_fee_rate, devShareRate: row.dev_share_rate, profitRate: row.profit_rate, settlementRuleCode: row.settlement_rule_code || 'legacy_fixed_fee_tax', channelFeeMode: row.channel_fee_mode || 'fixed', taxMode: row.tax_mode || 'share', validationTolerance: row.validation_tolerance ?? 0.05, systemSettlementAmount: row.system_settlement_amount ?? 0, platformSettlementAmount: row.platform_settlement_amount, settlementDifference: row.settlement_difference, validationStatus: row.validation_status || 'unvalidated', items }
  return { ...record, billNumber: row.statement_no || getChannelBillNumber(record) }
}

export function frontendChannelRecordToPayload(record: Record<string, unknown>): ChannelRecordPayload {
  const rawItems = record.items as Record<string, unknown>[] | undefined; const items = Array.isArray(rawItems) ? rawItems.map(frontendLineToPayload) : []
  return { statement_no: record.billNumber != null && String(record.billNumber).trim() ? String(record.billNumber).trim() : null, channel_name: (record.channelName as string) || null, partner_name: (record.partnerName as string) || null, settlement_month: (record.settlementMonth as string) || null, start_date: (record.startDate as string) || null, end_date: (record.endDate as string) || null, remark: record.remark != null && String(record.remark).trim() ? String(record.remark) : null, status: (record.status as string) || 'pending', server_cost: numOrNull(record.serverCost), discount_type: (record.discountType as string) || null, channel_fee_rate: numOrNull(record.channelFeeRate), dev_share_rate: numOrNull(record.devShareRate), profit_rate: numOrNull(record.profitRate), settlement_rule_code: String(record.settlementRuleCode || 'legacy_fixed_fee_tax'), channel_fee_mode: String(record.channelFeeMode || 'fixed'), tax_mode: String(record.taxMode || 'share'), validation_tolerance: Number(record.validationTolerance || 0.05), items }
}
export function getChannelRecordId(record: Record<string, unknown> | null | undefined): string { return record?.id == null ? '' : String(record.id) }
