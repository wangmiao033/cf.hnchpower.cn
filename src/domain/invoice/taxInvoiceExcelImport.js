import * as XLSX from 'xlsx'

const FULL_QUERY_SHEET = '发票基础信息'
const FULL_QUERY_DETAIL_SHEET = '信息汇总表'

function text(value) {
  return value == null ? '' : String(value).trim()
}
function normalizedHeader(value) {
  return text(value).replace(/[\s*]/g, '')
}

function rowValue(row, ...names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name]
  }
  const wanted = new Set(names.map(normalizedHeader))
  const key = Object.keys(row).find((item) => wanted.has(normalizedHeader(item)))
  return key ? row[key] : ''
}

function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const raw = text(value).replace(/[,￥¥\s]/g, '')
  if (!raw) return 0
  const negative = /^\(.*\)$/.test(raw)
  const parsed = Number(raw.replace(/[()]/g, ''))
  if (!Number.isFinite(parsed)) return 0
  return negative ? -parsed : parsed
}

function money(value) {
  return numberValue(value).toFixed(2)
}

function dateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  const raw = text(value)
  const match = raw.match(/(\d{4})[-/.\u5e74](\d{1,2})[-/.\u6708](\d{1,2})/)
  if (!match) return raw.slice(0, 10)
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function identityKey(row) {
  const digital = text(row.digitalInvoiceNo)
  if (digital) return `digital:${digital}`
  const code = text(row.invoiceCode)
  const number = text(row.invoiceNo)
  return code && number ? `legacy:${code}:${number}` : ''
}

function displayStatus(rawStatus) {
  const status = text(rawStatus)
  if (status.includes('作废')) return '作废'
  return '已开'
}

function taxStatus({ rawStatus, gross, positiveFlag, riskLevel, riskStatus }) {
  const status = text(rawStatus)
  if (status.includes('作废')) return 'void'
  if (status.includes('红') || gross < 0 || text(positiveFlag) === '否') return 'red'
  const risk = `${text(riskLevel)} ${text(riskStatus)}`
  if (risk && !/^(\u6b63\u5e38)?\s*(\u65e0\u98ce\u9669)?$/.test(risk)) return 'pending'
  return 'normal'
}

function joinRemark(...parts) {
  return parts.map(text).filter(Boolean).join('\n')
}

function sheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
}

function outputRecord(row, sourceFile) {
  const amount = numberValue(rowValue(row, '金额'))
  const tax = numberValue(rowValue(row, '税额'))
  const grossRaw = rowValue(row, '价税合计')
  const gross = text(grossRaw) ? numberValue(grossRaw) : amount + tax
  const rawStatus = text(rowValue(row, '发票状态'))
  const positiveFlag = text(rowValue(row, '是否正数发票'))
  const riskLevel = text(rowValue(row, '发票风险等级'))
  const buyerName = text(rowValue(row, '购买方名称', '购方名称'))
  const buyerTaxNo = text(rowValue(row, '购方识别号', '购买方识别号'))
  const record = {
    invoiceDirection: 'output',
    invoiceType: text(rowValue(row, '发票票种', '票种')),
    digitalInvoiceNo: text(rowValue(row, '数电发票号码')),
    invoiceCode: text(rowValue(row, '发票代码')),
    invoiceNo: text(rowValue(row, '发票号码')),
    buyerName,
    buyerTaxNo,
    sellerName: text(rowValue(row, '销方名称')),
    sellerTaxNo: text(rowValue(row, '销方识别号')),
    title: buyerName,
    taxNo: buyerTaxNo,
    amount: money(amount),
    taxAmount: money(tax),
    amountWithTax: money(gross),
    issueDate: dateValue(rowValue(row, '开票日期')),
    issuer: text(rowValue(row, '开票人')),
    invoiceSource: text(rowValue(row, '发票来源')),
    status: displayStatus(rawStatus),
    taxStatus: taxStatus({ rawStatus, gross, positiveFlag, riskLevel }),
    remark: joinRemark(
      rowValue(row, '备注'),
      `[税务Excel] 来源文件：${sourceFile}`,
      `税务状态：${rawStatus || '-'}`,
      positiveFlag ? `正数发票：${positiveFlag}` : '',
      riskLevel ? `风险等级：${riskLevel}` : ''
    ),
    verified: false,
    verifiedAmount: 0,
    verifiedRecordIds: []
  }
  record.invoiceIdentityKey = identityKey(record)
  return record
}

function inputRecord(row, sourceFile) {
  const amount = numberValue(rowValue(row, '金额'))
  const tax = numberValue(rowValue(row, '票面税额'))
  const gross = amount + tax
  const rawStatus = text(rowValue(row, '发票状态'))
  const riskLevel = text(rowValue(row, '发票风险等级'))
  const riskStatus = text(rowValue(row, '风险状态'))
  const checked = text(rowValue(row, '是否勾选'))
  const deductibleTax = numberValue(rowValue(row, '有效抵扣税额'))
  const redLock = text(rowValue(row, '红字锁定标志'))
  const buyerTaxNo = text(rowValue(row, '购买方识别号', '购方识别号'))
  const record = {
    invoiceDirection: 'input',
    invoiceType: text(rowValue(row, '票种', '发票票种')),
    digitalInvoiceNo: text(rowValue(row, '数电发票号码')),
    invoiceCode: text(rowValue(row, '发票代码')),
    invoiceNo: text(rowValue(row, '发票号码')),
    buyerName: '',
    buyerTaxNo,
    sellerName: text(rowValue(row, '销售方纳税人名称', '销方名称')),
    sellerTaxNo: text(rowValue(row, '销售方纳税人识别号', '销方识别号')),
    title: '',
    taxNo: '',
    amount: money(amount),
    taxAmount: money(tax),
    amountWithTax: money(gross),
    issueDate: dateValue(rowValue(row, '开票日期')),
    issuer: '',
    invoiceSource: text(rowValue(row, '发票来源')),
    status: displayStatus(rawStatus),
    taxStatus: taxStatus({ rawStatus, gross, riskLevel, riskStatus }),
    remark: joinRemark(
      `[税务Excel] 来源文件：${sourceFile}`,
      `抵扣勾选：${checked || '-'}`,
      `有效抵扣税额：${deductibleTax.toFixed(2)}`,
      redLock ? `红字锁定：${redLock}` : '',
      `风险：${[riskLevel, riskStatus].filter(Boolean).join('/') || '-'}`
    ),
    verified: false,
    verifiedAmount: 0,
    verifiedRecordIds: []
  }
  record.invoiceIdentityKey = identityKey(record)
  return record
}

function validRecords(records) {
  const unique = new Map()
  let skipped = 0
  records.forEach((record) => {
    if (!record.invoiceIdentityKey) {
      skipped += 1
      return
    }
    unique.set(record.invoiceIdentityKey, record)
  })
  return { records: Array.from(unique.values()), skipped }
}

function headersForSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
  return (rows[0] || []).map(normalizedHeader)
}

export function detectTaxInvoiceWorkbook(workbook) {
  if (workbook.Sheets[FULL_QUERY_SHEET]) {
    return { detected: true, type: 'output_full_query', sheetName: FULL_QUERY_SHEET }
  }
  if (workbook.Sheets[FULL_QUERY_DETAIL_SHEET]) {
    return { detected: true, type: 'output_full_query', sheetName: FULL_QUERY_DETAIL_SHEET }
  }
  for (const sheetName of workbook.SheetNames || []) {
    const headers = new Set(headersForSheet(workbook, sheetName))
    if (headers.has('是否勾选') && headers.has('有效抵扣税额') && headers.has('购买方识别号')) {
      return { detected: true, type: 'input_deduction', sheetName }
    }
  }
  return { detected: false, type: 'unknown', sheetName: '' }
}

export function parseTaxInvoiceWorkbook(workbook, sourceFile = '税务发票导出.xlsx') {
  const detected = detectTaxInvoiceWorkbook(workbook)
  if (!detected.detected) {
    return {
      detected: false,
      type: 'unknown',
      label: '未识别的税务 Excel',
      records: [],
      skipped: 0
    }
  }

  const rows = sheetRows(workbook, detected.sheetName)
  const parsed = rows.map((row) =>
    detected.type === 'input_deduction'
      ? inputRecord(row, sourceFile)
      : outputRecord(row, sourceFile)
  )
  const result = validRecords(parsed)
  return {
    ...detected,
    label: detected.type === 'input_deduction' ? '进项抵扣勾选' : '销项全量发票',
    records: result.records,
    skipped: result.skipped
  }
}
