const FIELD_LABELS = {
  statement_no: '账单编号',
  settlement_month: '结算月份',
  partner_name: '合作方',
  channel_name: '渠道',
  game_name: '产品',
  game_flow: '研发流水',
  billing_flow: '渠道流水',
  settlement_amount: '结算金额',
  received_amount: '已收金额',
  receipt_status: '收款状态',
  status: '账单状态',
  archive_state: '归档状态',
  revenue_share_rate: '研发分成比例',
  share_rate: '分成比例',
  dev_share_rate: '研发分成比例',
  channel_fee_rate: '通道费率',
  tax_rate: '税率',
  discount_value: '折扣',
  discount_type: '折扣类型',
  refund_amount: '退款金额',
  refund_cost: '退款成本',
  test_cost: '测试费',
  voucher_cost: '代金券',
  remark: '备注',
  amount: '金额',
  linked_amount: '关联金额',
  trade_date: '交易日期',
  receipt_date: '收款日期',
  bank_account: '银行账户',
  transaction_no: '银行流水号',
  reconciliation_no: '关联账单号',
  allocated_gross_amount: '发票分配金额',
  invoice_id: '发票',
  match_type: '匹配方式',
  match_score: '匹配度',
  transfer_status: '付款状态',
  remittance_amount: '付款金额',
  payment_date: '付款日期',
  transaction_serial: '付款流水号',
  remitter_company: '付款方',
  payee_company: '收款方',
  file_name: '附件名称',
  file_size: '附件大小'
}

const MONEY_FIELDS = new Set([
  'game_flow',
  'billing_flow',
  'settlement_amount',
  'received_amount',
  'refund_amount',
  'refund_cost',
  'test_cost',
  'voucher_cost',
  'amount',
  'linked_amount',
  'allocated_gross_amount',
  'remittance_amount'
])

const PERCENT_FIELDS = new Set([
  'revenue_share_rate',
  'share_rate',
  'dev_share_rate',
  'channel_fee_rate',
  'tax_rate'
])

const ACTION_META = {
  create: { label: '创建', tone: 'create', mark: '建' },
  update: { label: '修改', tone: 'update', mark: '改' },
  delete: { label: '删除', tone: 'delete', mark: '删' },
  status_change: { label: '状态变更', tone: 'status', mark: '态' },
  archive: { label: '归档', tone: 'status', mark: '档' },
  unarchive: { label: '取消归档', tone: 'update', mark: '启' },
  receipt_add: { label: '登记收款', tone: 'money', mark: '收' },
  receipt_delete: { label: '删除收款', tone: 'delete', mark: '删' },
  receipt_update: { label: '修改收款', tone: 'money', mark: '收' },
  payment_add: { label: '登记收付款', tone: 'money', mark: '款' },
  payment_delete: { label: '删除收付款', tone: 'delete', mark: '删' },
  payment_update: { label: '修改收付款', tone: 'money', mark: '款' },
  payment_instruction_create: { label: '创建付款指令', tone: 'money', mark: '付' },
  payment_instruction_update: { label: '更新付款指令', tone: 'money', mark: '付' },
  payment_instruction_delete: { label: '删除付款指令', tone: 'delete', mark: '删' },
  bank_match_confirm: { label: '确认银行核销', tone: 'money', mark: '银' },
  bank_match_reverse: { label: '撤销银行核销', tone: 'delete', mark: '银' },
  bank_match_update: { label: '更新银行核销', tone: 'money', mark: '银' },
  invoice_link: { label: '关联发票', tone: 'invoice', mark: '票' },
  invoice_unlink: { label: '撤销发票', tone: 'delete', mark: '票' },
  invoice_link_update: { label: '更新发票关联', tone: 'invoice', mark: '票' },
  attachment_add: { label: '上传附件', tone: 'create', mark: '附' },
  attachment_update: { label: '更新附件', tone: 'update', mark: '附' },
  attachment_delete: { label: '删除附件', tone: 'delete', mark: '附' }
}

const ACTION_CATEGORY = {
  status_change: 'status',
  archive: 'status',
  unarchive: 'status',
  receipt_add: 'funding',
  receipt_delete: 'funding',
  receipt_update: 'funding',
  payment_add: 'funding',
  payment_delete: 'funding',
  payment_update: 'funding',
  payment_instruction_create: 'funding',
  payment_instruction_update: 'funding',
  payment_instruction_delete: 'funding',
  bank_match_confirm: 'funding',
  bank_match_reverse: 'funding',
  bank_match_update: 'funding',
  invoice_link: 'invoice',
  invoice_unlink: 'invoice',
  invoice_link_update: 'invoice',
  attachment_add: 'attachment',
  attachment_update: 'attachment',
  attachment_delete: 'attachment'
}

function unwrapJsonValue(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return value
}

function compactObject(value) {
  if (value == null) return '-'
  if (Array.isArray(value)) return value.length ? `${value.length} 项` : '-'
  if (typeof value === 'object') return '已记录'
  return String(value)
}

export function operationActionMeta(action) {
  return ACTION_META[action] || { label: action || '操作', tone: 'default', mark: '记' }
}

export function operationActionCategory(action) {
  return ACTION_CATEGORY[action] || 'bill'
}

export function operationFieldLabel(field) {
  return FIELD_LABELS[field] || field
}

export function formatOperationValue(field, raw) {
  const value = unwrapJsonValue(raw)
  if (value === null || value === undefined || value === '') return '-'
  if (field === 'file_size') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      if (numeric < 1024 * 1024) return `${Math.ceil(numeric / 1024)} KB`
      return `${(numeric / 1024 / 1024).toFixed(1)} MB`
    }
  }
  if (MONEY_FIELDS.has(field)) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return `¥${numeric.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
  }
  if (PERCENT_FIELDS.has(field)) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return `${numeric}%`
  }
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'object') return compactObject(value)
  const text = String(value)
  return text.length > 80 ? `${text.slice(0, 77)}…` : text
}

export function operationChangeLines(changes = {}, limit = 8) {
  if (!changes || typeof changes !== 'object') return []
  const rows = []
  for (const [field, change] of Object.entries(changes)) {
    if (field === 'record' || field === 'receipt' || field === 'payment' || field === 'instruction' || field === 'allocation') {
      rows.push({
        field,
        label: field === 'record' ? '原记录' : field === 'receipt' ? '收款记录' : field === 'payment' ? '银行流水' : field === 'instruction' ? '付款指令' : '发票关联',
        before: '已归档',
        after: '-'
      })
      continue
    }
    const safe = change && typeof change === 'object' ? change : {}
    rows.push({
      field,
      label: operationFieldLabel(field),
      before: formatOperationValue(field, safe.before),
      after: formatOperationValue(field, safe.after)
    })
  }
  return rows.slice(0, limit)
}

export function operationActorLabel(log) {
  const email = String(log?.actor_email || '').trim()
  if (!email) return '系统'
  const local = email.split('@')[0]
  return local || email
}

export function operationHiddenChangeCount(changes = {}, shown = 8) {
  if (!changes || typeof changes !== 'object') return 0
  return Math.max(0, Object.keys(changes).length - shown)
}
