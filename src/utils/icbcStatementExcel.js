import * as XLSX from 'xlsx'

const FIELD_ALIASES = {
  tradeDate: ['日期', '交易日期', '记账日期', '入账日期'],
  direction: ['借贷标志', '借贷方向', '收支标志', '收支方向'],
  counterparty: ['对方单位', '对方户名', '对方名称', '对方单位名称', '交易对手'],
  purpose: ['用途', '交易用途', '款项用途'],
  summary: ['摘要', '交易摘要'],
  remark: ['附言', '备注', '交易附言'],
  expenseAmount: ['转出金额', '借方发生额', '借方金额', '支出金额', '付款金额'],
  incomeAmount: ['转入金额', '贷方发生额', '贷方金额', '收入金额', '收款金额'],
  balance: ['余额', '账户余额', '本次余额'],
  transactionNo: ['流水号', '交易流水号', '交易序号', '业务编号', '凭证号'],
  counterpartyAccount: ['对方账号', '对方账户', '对方帐号']
}

function cleanText(value) {
  if (value == null) return ''
  return String(value).replace(/\u00a0/g, ' ').trim()
}

function normalizeHeader(value) {
  return cleanText(value)
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/人民币|RMB|CNY|元/gi, '')
    .replace(/[\s_\-—]/g, '')
    .toLowerCase()
}

const NORMALIZED_ALIASES = Object.fromEntries(
  Object.entries(FIELD_ALIASES).map(([key, aliases]) => [key, aliases.map(normalizeHeader)])
)

function matchHeader(value) {
  const normalized = normalizeHeader(value)
  if (!normalized) return null
  for (const [key, aliases] of Object.entries(NORMALIZED_ALIASES)) {
    if (aliases.some((alias) => normalized === alias || normalized.startsWith(alias))) return key
  }
  return null
}

function detectHeaderRow(matrix) {
  let best = null
  const maxRows = Math.min(matrix.length, 40)
  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const row = matrix[rowIndex] || []
    const map = {}
    row.forEach((cell, colIndex) => {
      const key = matchHeader(cell)
      if (key && map[key] == null) map[key] = colIndex
    })
    const keys = Object.keys(map)
    const hasAmount = map.expenseAmount != null || map.incomeAmount != null || map.direction != null
    const score = keys.length + (map.tradeDate != null ? 2 : 0) + (hasAmount ? 2 : 0) + (map.balance != null ? 1 : 0)
    if (map.tradeDate != null && hasAmount && (!best || score > best.score)) {
      best = { rowIndex, map, score }
    }
  }
  if (!best || best.score < 6) {
    throw new Error('未识别到工商银行流水表头，请确认文件包含“日期、借贷标志/转入转出金额、对方单位、余额”等列。')
  }
  return best
}

function parseMoney(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100
  let text = cleanText(value)
  if (!text || text === '-' || text === '--') return null
  const negative = /^\(.*\)$/.test(text)
  text = text.replace(/[(),，\s￥¥]/g, '').replace(/[^0-9.+-]/g, '')
  if (!text) return null
  const num = Number(text)
  if (!Number.isFinite(num)) return null
  const normalized = negative ? -Math.abs(num) : num
  return Math.round(normalized * 100) / 100
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatDateParts(year, month, day) {
  if (!year || !month || !day) return ''
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`
}

function parseExcelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate())
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed?.y && parsed?.m && parsed?.d) return formatDateParts(parsed.y, parsed.m, parsed.d)
  }
  const text = cleanText(value)
  if (!text) return ''
  let m = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?/)
  if (m) return formatDateParts(Number(m[1]), Number(m[2]), Number(m[3]))
  m = text.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return formatDateParts(Number(m[1]), Number(m[2]), Number(m[3]))
  const d = new Date(text)
  if (!Number.isNaN(d.getTime())) return formatDateParts(d.getFullYear(), d.getMonth() + 1, d.getDate())
  return ''
}

function parseDirection(raw, expenseAmount, incomeAmount) {
  const text = cleanText(raw).toLowerCase()
  if (/借|支出|付款|转出|debit/.test(text)) return 'debit'
  if (/贷|收入|收款|转入|credit/.test(text)) return 'credit'
  if ((expenseAmount || 0) > 0 && !((incomeAmount || 0) > 0)) return 'debit'
  if ((incomeAmount || 0) > 0 && !((expenseAmount || 0) > 0)) return 'credit'
  return ''
}

function valueAt(row, map, key) {
  const idx = map[key]
  return idx == null ? '' : row[idx]
}

function buildRawText(header, row) {
  const parts = []
  for (let i = 0; i < Math.max(header.length, row.length); i += 1) {
    const label = cleanText(header[i]) || `列${i + 1}`
    const value = cleanText(row[i])
    if (value) parts.push(`${label}: ${value}`)
  }
  return parts.join('\n')
}

function detectMetadata(matrix, headerRowIndex) {
  const before = matrix.slice(0, Math.max(headerRowIndex, 0))
  const text = before.flat().map(cleanText).filter(Boolean).join('\n')
  const accountMatch = text.match(/(?:账号|帐号|账户)[：:\s]*([0-9*]{8,})/)
  const accountNameMatch = text.match(/(?:户名|账户名称|单位名称)[：:\s]*([^\n]{2,80})/)
  return {
    bankAccount: accountMatch?.[1] || '',
    accountName: accountNameMatch?.[1]?.trim() || ''
  }
}

function isEmptyRow(row) {
  return !row || row.every((cell) => cleanText(cell) === '')
}

export function parseIcbcStatementMatrix(matrix, options = {}) {
  if (!Array.isArray(matrix) || matrix.length === 0) throw new Error('Excel 文件没有可读取的数据。')
  const { rowIndex: headerRowIndex, map } = detectHeaderRow(matrix)
  const header = matrix[headerRowIndex] || []
  const metadata = detectMetadata(matrix, headerRowIndex)
  const rows = []
  const invalidRows = []

  for (let i = headerRowIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] || []
    if (isEmptyRow(row)) continue
    const tradeDate = parseExcelDate(valueAt(row, map, 'tradeDate'))
    let expenseAmount = parseMoney(valueAt(row, map, 'expenseAmount'))
    let incomeAmount = parseMoney(valueAt(row, map, 'incomeAmount'))
    const direction = parseDirection(valueAt(row, map, 'direction'), expenseAmount, incomeAmount)

    if (direction === 'debit' && expenseAmount == null) {
      expenseAmount = parseMoney(valueAt(row, map, 'incomeAmount'))
      incomeAmount = null
    }
    if (direction === 'credit' && incomeAmount == null) {
      incomeAmount = parseMoney(valueAt(row, map, 'expenseAmount'))
      expenseAmount = null
    }

    const hasExpense = (expenseAmount || 0) !== 0
    const hasIncome = (incomeAmount || 0) !== 0
    const reasons = []
    if (!tradeDate) reasons.push('日期无法识别')
    if (!direction) reasons.push('借贷方向无法识别')
    if (!hasExpense && !hasIncome) reasons.push('交易金额为空')
    if (hasExpense && hasIncome) reasons.push('同时存在转入和转出金额')

    const parsed = {
      sourceRowNo: i + 1,
      tradeDate,
      direction,
      counterparty: cleanText(valueAt(row, map, 'counterparty')),
      counterpartyAccount: cleanText(valueAt(row, map, 'counterpartyAccount')),
      purpose: cleanText(valueAt(row, map, 'purpose')),
      summary: cleanText(valueAt(row, map, 'summary')),
      remark: cleanText(valueAt(row, map, 'remark')),
      expenseAmount: hasExpense ? Math.abs(expenseAmount) : null,
      incomeAmount: hasIncome ? Math.abs(incomeAmount) : null,
      balance: parseMoney(valueAt(row, map, 'balance')),
      transactionNo: cleanText(valueAt(row, map, 'transactionNo')),
      rawText: buildRawText(header, row)
    }

    if (reasons.length) invalidRows.push({ ...parsed, reasons })
    else rows.push(parsed)
  }

  if (rows.length === 0 && invalidRows.length === 0) throw new Error('表头已识别，但没有发现流水明细。')

  const dateValues = rows.map((row) => row.tradeDate).filter(Boolean).sort()
  const incomeTotal = rows.reduce((sum, row) => sum + (row.incomeAmount || 0), 0)
  const expenseTotal = rows.reduce((sum, row) => sum + (row.expenseAmount || 0), 0)
  const balances = rows.map((row) => row.balance).filter((v) => Number.isFinite(v))

  return {
    sourceBank: options.sourceBank || 'ICBC',
    bankName: '中国工商银行',
    headerRowNo: headerRowIndex + 1,
    metadata,
    rows,
    invalidRows,
    summary: {
      validRows: rows.length,
      invalidRows: invalidRows.length,
      incomeRows: rows.filter((row) => (row.incomeAmount || 0) > 0).length,
      expenseRows: rows.filter((row) => (row.expenseAmount || 0) > 0).length,
      incomeTotal: Math.round(incomeTotal * 100) / 100,
      expenseTotal: Math.round(expenseTotal * 100) / 100,
      netAmount: Math.round((incomeTotal - expenseTotal) * 100) / 100,
      dateFrom: dateValues[0] || '',
      dateTo: dateValues[dateValues.length - 1] || '',
      firstBalance: balances.length ? balances[balances.length - 1] : null,
      lastBalance: balances.length ? balances[0] : null
    }
  }
}

export async function parseIcbcStatementExcel(file) {
  if (!file) throw new Error('请选择 Excel 文件。')
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  if (!workbook.SheetNames.length) throw new Error('Excel 文件中没有工作表。')

  let best = null
  const errors = []
  for (const sheetName of workbook.SheetNames) {
    try {
      const worksheet = workbook.Sheets[sheetName]
      const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: '' })
      const parsed = parseIcbcStatementMatrix(matrix)
      if (!best || parsed.rows.length > best.rows.length) best = { ...parsed, sheetName }
    } catch (error) {
      errors.push(`${sheetName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (!best) throw new Error(errors[0] || '没有找到可识别的工商银行流水工作表。')
  return best
}

export function icbcRowToBankTransaction(row, context = {}) {
  const counterparty = cleanText(row.counterparty)
  const counterpartyAccount = cleanText(row.counterpartyAccount)
  const isIncome = row.direction === 'credit'
  const amount = isIncome ? row.incomeAmount : row.expenseAmount
  return {
    type: 'statement_import',
    trade_date: row.tradeDate || null,
    bank_account: cleanText(context.bankAccount) || null,
    payer_name: isIncome ? counterparty || null : null,
    payer_account: isIncome ? counterpartyAccount || null : null,
    payer_bank_name: null,
    payee_name: isIncome ? null : counterparty || null,
    payee_account: isIncome ? null : counterpartyAccount || null,
    payee_bank_name: null,
    amount: Number.isFinite(amount) ? amount : null,
    income_amount: Number.isFinite(row.incomeAmount) ? row.incomeAmount : null,
    expense_amount: Number.isFinite(row.expenseAmount) ? row.expenseAmount : null,
    balance: Number.isFinite(row.balance) ? row.balance : null,
    currency: 'CNY',
    transaction_no: cleanText(row.transactionNo) || null,
    instruction_no: null,
    summary: cleanText(row.summary) || null,
    purpose: cleanText(row.purpose) || null,
    remark: cleanText(row.remark) || null,
    status: null,
    raw_text: cleanText(row.rawText) || null,
    attachment_url: null,
    source_bank: context.sourceBank || 'ICBC',
    source_file_name: cleanText(context.fileName) || null,
    source_row_no: row.sourceRowNo || null
  }
}
