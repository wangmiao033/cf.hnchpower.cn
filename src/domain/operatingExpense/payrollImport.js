const COMPANY_HINTS = [
  '广州熊动科技有限公司',
  '广州超凡响应网络科技有限公司'
]

const MONTH_MAP = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12
}

const HEADER_ALIASES = {
  employee_name: ['姓名'],
  gross_salary: ['税前工资', '应发工资'],
  tax_adjustment: ['补税'],
  pension_insurance: ['养老保险'],
  medical_insurance: ['医疗保险'],
  unemployment_insurance: ['失业保险'],
  housing_fund: ['公积金'],
  leave_deduction: ['请假扣除'],
  late_deduction: ['迟到罚款'],
  deduction_total: ['代扣小计', '小计'],
  income_tax: ['个人所得税', '个税'],
  net_salary: ['税后实发', '实发工资合计', '实发工资'],
  signature_date: ['签名/日期', '签名日期']
}

function text(value) {
  return String(value ?? '').replace(/\s+/g, '').trim()
}

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const cleaned = String(value ?? '').replace(/[￥¥,，\s]/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function findColumn(headers, aliases) {
  const normalized = headers.map(text)
  for (const alias of aliases) {
    const index = normalized.indexOf(text(alias))
    if (index >= 0) return index
  }
  return -1
}

function parseMonthLabel(source) {
  const compact = text(source)
  // Old template: "2026年八月", new monthly workbook: "2026-05" or "5月2026".
  // Match sheet-specific labels before the shared workbook filename (which can contain a date range).
  const chinese = compact.match(/(20\d{2})年([一二三四五六七八九十]{1,3}|1[0-2]|0?[1-9])月/)
  const iso = compact.match(/(20\d{2})[-/.](1[0-2]|0?[1-9])(?=[^\d]|$)/)
  const reversed = compact.match(/(1[0-2]|0?[1-9])月(20\d{2})年?/)
  const year = Number(chinese?.[1] || iso?.[1] || reversed?.[2])
  const raw = chinese?.[2] || iso?.[2] || reversed?.[1]
  const month = /^\d+$/.test(raw || '') ? Number(raw) : MONTH_MAP[raw]
  if (!year || !month || month < 1 || month > 12) return ''
  return `${year}-${String(month).padStart(2, '0')}`
}

function inferCompany(source) {
  const compact = text(source)
  const known = COMPANY_HINTS.find((name) => compact.includes(text(name).replace('有限公司', '')))
  if (known) return known
  const match = compact.match(/([^\s]{2,40}(?:有限责任公司|有限公司))/)
  return match?.[1] || ''
}

function buildColumnMap(headers) {
  return Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, findColumn(headers, aliases)])
  )
}

function cell(row, index) {
  return index >= 0 ? row[index] : null
}

export function parsePayrollRows(rows, sourceName = '') {
  const safeRows = Array.isArray(rows) ? rows : []
  let headerIndex = -1
  let columns = null

  for (let index = 0; index < Math.min(safeRows.length, 20); index += 1) {
    const row = safeRows[index] || []
    const candidate = buildColumnMap(row)
    if (candidate.employee_name >= 0 && candidate.gross_salary >= 0 && candidate.net_salary >= 0) {
      headerIndex = index
      columns = candidate
      break
    }
  }

  if (headerIndex < 0 || !columns) {
    throw new Error('未识别到工资表表头：至少需要“姓名、税前工资/应发工资、税后实发/实发工资”')
  }

  const titleText = safeRows
    .slice(0, headerIndex)
    .flat()
    .filter((value) => value != null && String(value).trim())
    .join(' ')

  const expenseMonth = parseMonthLabel(`${titleText} ${sourceName}`)
  const companyName = inferCompany(`${titleText} ${sourceName}`)
  const items = []

  for (let rowIndex = headerIndex + 1; rowIndex < safeRows.length; rowIndex += 1) {
    const row = safeRows[rowIndex] || []
    const name = String(cell(row, columns.employee_name) ?? '').trim()
    if (!name) continue
    if (text(name).includes('合计')) break

    const grossSalary = round2(number(cell(row, columns.gross_salary)))
    if (grossSalary === 0 && !String(cell(row, columns.net_salary) ?? '').trim()) continue

    const taxAdjustment = round2(number(cell(row, columns.tax_adjustment)))
    const pension = round2(number(cell(row, columns.pension_insurance)))
    const medical = round2(number(cell(row, columns.medical_insurance)))
    const unemployment = round2(number(cell(row, columns.unemployment_insurance)))
    const housing = round2(number(cell(row, columns.housing_fund)))
    const leaveDeduction = round2(number(cell(row, columns.leave_deduction)))
    const lateDeduction = round2(number(cell(row, columns.late_deduction)))
    const expectedDeduction = round2(
      taxAdjustment + pension + medical + unemployment + housing + leaveDeduction + lateDeduction
    )
    const sheetDeduction =
      columns.deduction_total >= 0
        ? round2(number(cell(row, columns.deduction_total)))
        : expectedDeduction
    const incomeTax = round2(number(cell(row, columns.income_tax)))
    const expectedNet = round2(grossSalary - sheetDeduction - incomeTax)
    const sheetNet =
      columns.net_salary >= 0
        ? round2(number(cell(row, columns.net_salary)))
        : expectedNet
    const deductionDifference = round2(sheetDeduction - expectedDeduction)
    const netDifference = round2(sheetNet - expectedNet)
    const valid = Math.abs(deductionDifference) <= 0.01 && Math.abs(netDifference) <= 0.01

    items.push({
      employee_name: name,
      gross_salary: grossSalary,
      tax_adjustment: taxAdjustment,
      pension_insurance: pension,
      medical_insurance: medical,
      unemployment_insurance: unemployment,
      housing_fund: housing,
      leave_deduction: leaveDeduction,
      late_deduction: lateDeduction,
      deduction_total: sheetDeduction,
      income_tax: incomeTax,
      net_salary: sheetNet,
      signature_date: String(cell(row, columns.signature_date) ?? '').trim() || null,
      sort_order: items.length,
      validation_status: valid ? 'valid' : 'mismatch',
      deduction_difference: deductionDifference,
      net_difference: netDifference
    })
  }

  if (!items.length) throw new Error('工资表中没有识别到有效员工明细')

  const totals = items.reduce(
    (sum, item) => ({
      gross_salary: round2(sum.gross_salary + item.gross_salary),
      employee_deduction_total: round2(sum.employee_deduction_total + item.deduction_total),
      income_tax_total: round2(sum.income_tax_total + item.income_tax),
      net_salary_total: round2(sum.net_salary_total + item.net_salary)
    }),
    { gross_salary: 0, employee_deduction_total: 0, income_tax_total: 0, net_salary_total: 0 }
  )

  return {
    expenseMonth,
    companyName,
    items,
    totals,
    validationStatus: items.some((item) => item.validation_status !== 'valid') ? 'mismatch' : 'valid'
  }
}

function safeFilename(name) {
  const raw = String(name || '工资表.xlsx')
  try { return /%[0-9a-f]{2}/i.test(raw) ? decodeURIComponent(raw) : raw } catch { return raw }
}

function isPayrollHeader(rows) {
  return (rows || []).slice(0, 30).some((row) => {
    const columns = buildColumnMap(row || [])
    return columns.employee_name >= 0 && columns.gross_salary >= 0 && columns.net_salary >= 0
  })
}

/**
 * One workbook may contain many company/month batches plus instructions and summaries.
 * Only real payroll sheets become batches; instructions and notes are never booked as wages.
 */
export function parsePayrollWorkbookSheets(sheets, sourceName = '') {
  const filename = safeFilename(sourceName)
  const results = []
  for (const sheet of sheets || []) {
    const sheetName = String(sheet?.name || '').trim()
    if (/^(导入说明|说明|工资汇总|汇总|使用指南|readme)/i.test(sheetName)) continue
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : []
    const title = rows.slice(0, 4).flat().filter((value) => value != null).join(' ')
    const display = `${filename} · ${sheetName}`
    if (!isPayrollHeader(rows)) {
      if (/工资表|工资明细|薪资表|payroll/i.test(`${sheetName} ${title}`)) {
        results.push({ fileName: display, sheetName, items: [],
          error: '此工作表缺少“姓名 / 应发工资 / 实发工资”表头，请核对源文件' })
      }
      continue
    }
    try {
      const parsed = parsePayrollRows(rows, `${sheetName} ${filename}`)
      // Do not silently default a multi-month workbook to the currently selected month.
      if (!parsed.expenseMonth) throw new Error('无法识别工资月份，请检查工作表名称或标题')
      results.push({ fileName: display, sheetName, ...parsed, error: '' })
    } catch (error) {
      results.push({ fileName: display, sheetName, items: [],
        error: error instanceof Error ? error.message : '工作表解析失败' })
    }
  }
  if (!results.length) {
    throw new Error('未在 Excel 中找到工资明细工作表。可以直接选择包含 5—8 月的整本工资表。')
  }
  return results
}

export async function parsePayrollFile(file) {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, cellFormula: true })
  if (!workbook.SheetNames?.length) throw new Error('Excel 中没有可读取的工作表')
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null, raw: true })
  }))
  return parsePayrollWorkbookSheets(sheets, file.name)
}

export { COMPANY_HINTS as PAYROLL_COMPANY_SUGGESTIONS }
