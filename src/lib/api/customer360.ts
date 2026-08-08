import { apiGet } from '@/lib/api/client.ts'

export type Customer360Partner = {
  id: string
  name: string
  short_name: string
  category: string
  tag: string
  tax_registration_no: string
  bank_name: string
  bank_account: string
  invoice_content: string
  recipient: string
  recipient_phone: string
  mailing_address: string
  created_at: string | null
  updated_at: string | null
}

export type Customer360Access = {
  contracts: boolean
  reconciliation: boolean
  invoices: boolean
  funds: boolean
}

export type Customer360Summary = {
  contract_count: number | null
  active_contract_count: number | null
  contract_amount: number | null
  rd_bill_count: number | null
  rd_settlement_amount: number | null
  rd_paid_amount: number | null
  rd_unpaid_amount: number | null
  channel_bill_count: number | null
  channel_settlement_amount: number | null
  channel_received_amount: number | null
  channel_unreceived_amount: number | null
  invoice_count: number | null
  invoice_amount: number | null
  input_invoice_count: number | null
  output_invoice_count: number | null
  bank_transaction_count: number | null
  bank_inflow_amount: number | null
  bank_outflow_amount: number | null
  latest_trade_date: string | null
}

export type Customer360Contract = {
  id: string
  internal_contract_no: string
  contract_no: string
  contract_name: string
  contract_type: string
  products: string[]
  channels: string[]
  amount: number
  effective_date: string | null
  end_date: string | null
  performance_status: string
  payment_type: string
  state: 'active' | 'pending' | 'expired' | 'ended'
  created_at: string | null
  updated_at: string | null
}

export type Customer360RdBill = {
  id: string
  statement_no: string
  settlement_month: string
  games: string
  settlement_amount: number
  paid_amount: number
  unpaid_amount: number
  payment_status: string
  latest_payment_date: string | null
  status: string
  created_at: string | null
  updated_at: string | null
}

export type Customer360ChannelBill = {
  id: string
  statement_no: string
  settlement_month: string
  games: string
  settlement_amount: number
  received_amount: number
  unreceived_amount: number
  receipt_status: string
  status: string
  created_at: string | null
  updated_at: string | null
}

export type Customer360Invoice = {
  id: string
  direction: 'input' | 'output'
  invoice_no: string
  invoice_date: string
  buyer_name: string
  seller_name: string
  amount: number
  tax_amount: number
  tax_status: string
  status: string
  created_at: string | null
  updated_at: string | null
}

export type Customer360BankTransaction = {
  id: string
  type: string
  trade_date: string
  transaction_no: string
  payer_name: string
  payee_name: string
  summary: string
  inflow: number
  outflow: number
  currency: string
  reconciliation_no: string
  status: string
  created_at: string | null
  updated_at: string | null
}

export type Customer360Activity = {
  kind: 'contract' | 'rd_bill' | 'channel_bill' | 'invoice' | 'bank_transaction'
  entity_id: string
  date: string | null
  title: string
  amount: number
  meta: string
}

export type Customer360Response = {
  partner: Customer360Partner
  access: Customer360Access
  summary: Customer360Summary
  contracts: Customer360Contract[]
  rd_bills: Customer360RdBill[]
  channel_bills: Customer360ChannelBill[]
  invoices: Customer360Invoice[]
  bank_transactions: Customer360BankTransaction[]
  recent_activities: Customer360Activity[]
}

export function getCustomer360(partnerId: string) {
  return apiGet<Customer360Response>(
    `/api/workbench/customer-360/${encodeURIComponent(partnerId)}`
  )
}
