import * as XLSX from 'xlsx'
import { buildFullChannelRecord } from './channelBillingForm.js'

const HEADER_ALIASES = {
  gameName: ['游戏名字', '游戏名称', '产品名称'],
  flow: ['月充值', '充值流水', '充值金额'],
  testCost: ['测试流水', '测试费'],
  voucherCost: ['代金券', '券金额'],
  coinCost: ['金币', '金币费用'],
  refundCost: ['退款', '退款费'],
  shareRate: ['分成比例', '分成'],
  channelFeeRate: ['渠道费', '渠道费率'],
  taxRate: ['税点', '税率'],
  settlementAmount: ['结算金额']
}

function clean(value) {
  return value == null ? '' : String(value).replace(/\s+/g, ' ').trim()
}

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(clean(value).replace(/[¥￥,%，]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function percent(value) {
  const raw = number(value)
  if (!raw) return 0
  return Math.abs(raw) <= 1 ? raw * 100 : raw
}

function findColumn(headers, aliases) {
  return headers.findIndex((header) => aliases.some((alias) => clean(header).includes(alias)))
}

function findLabelValue(rows, aliases) {
  for (const row of rows) {
    for (let index = 0; index < row.length; index += 1) {
      const cell = clean(row[index])
      const alias = aliases.find((item) => cell.startsWith(item))
      if (!alias) continue
      const inline = cell.slice(alias.length).replace(/^[：:]\s*/, '').trim()
      if (inline) return inline
      for (let next = index + 1; next < row.length; next += 1) {
        const candidate = clean(row[next])
        if (candidate) return candidate
      }
    }
  }
  return ''
}

function monthFromSheet(sheetName, rows) {
  const candidates = [sheetName, ...rows.slice(0, 8).flat().map(clean)]
  for (const candidate of candidates) {
    const match = candidate.match(/(20\d{2})\D{0,3}(0?[1-9]|1[0-2])(?:月)?/)
    if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
  }
  return ''
}

function monthDates(month) {
  const match = month.match(/^(\d{4})-(\d{2})$/)
  if (!match) return { startDate: '', endDate: '' }
  const year = Number(match[1])
  const monthNumber = Number(match[2])
  const lastDay = new Date(year, monthNumber, 0).getDate()
  return {
    startDate: `${match[1]}-${match[2]}-01`,
    endDate: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`
  }
}

function parseStatementSheet(sheet, sheetName, sourceFile) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map(clean)
    return (
      findColumn(cells, HEADER_ALIASES.gameName) >= 0 &&
      findColumn(cells, HEADER_ALIASES.flow) >= 0 &&
      findColumn(cells, HEADER_ALIASES.settlementAmount) >= 0
    )
  })
  if (headerIndex < 0) return null

  const headers = rows[headerIndex].map(clean)
  const columns = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, findColumn(headers, aliases)])
  )
  const month = monthFromSheet(sheetName, rows)
  const dates = monthDates(month)
  const lineItems = []
  let statementTotal = null

  for (const row of rows.slice(headerIndex + 1)) {
    const gameName = columns.gameName >= 0 ? clean(row[columns.gameName]) : ''
    const flow = columns.flow >= 0 ? number(row[columns.flow]) : 0
    const settlement = columns.settlementAmount >= 0 ? number(row[columns.settlementAmount]) : 0
    const rowText = row.map(clean).filter(Boolean).join(' ')
    if (/合计|总计/.test(rowText)) {
      statementTotal = settlement || statementTotal
      continue
    }
    if (!gameName || (!flow && !settlement)) continue

    lineItems.push({
      settlementCycle: month,
      gameName,
      flow,
      discountFactor: 1,
      voucherCost: columns.voucherCost >= 0 ? number(row[columns.voucherCost]) : 0,
      noWorryCost: 0,
      refundCost: columns.refundCost >= 0 ? number(row[columns.refundCost]) : 0,
      testCost: columns.testCost >= 0 ? number(row[columns.testCost]) : 0,
      welfareCost: 0,
      coinCost: columns.coinCost >= 0 ? number(row[columns.coinCost]) : 0,
      shareRate: columns.shareRate >= 0 ? percent(row[columns.shareRate]) : 0,
      taxRate: columns.taxRate >= 0 ? percent(row[columns.taxRate]) : 0,
      channelFeeRate: columns.channelFeeRate >= 0 ? percent(row[columns.channelFeeRate]) : 0,
      gatewayCost: 0,
      calculationMode: 'channel_statement',
      settlementAmount: columns.settlementAmount >= 0 ? row[columns.settlementAmount] : ''
    })
  }
  if (lineItems.length === 0) return null

  const channelName =
    findLabelValue(rows, ['开票名称', '开票方', '甲方']) ||
    findLabelValue(rows, ['渠道名称', '渠道公司']) ||
    '渠道结算单'
  const partnerName = findLabelValue(rows, ['致', '收件方', '乙方'])
  const record = buildFullChannelRecord(
    {
      channelName,
      partnerName,
      settlementMonth: month,
      startDate: dates.startDate,
      endDate: dates.endDate,
      remark: `导入自 ${sourceFile} · ${sheetName}`,
      status: 'pending',
      invoiceStatus: 'pending_invoice'
    },
    lineItems
  )
  if (statementTotal !== null) record.settlementAmount = statementTotal
  record.importFormat = 'channel_monthly_statement'
  record.sourceFile = sourceFile
  record.sourceSheet = sheetName
  return record
}

export function parseChannelStatementWorkbook(workbook, sourceFile = '') {
  const records = workbook.SheetNames
    .map((sheetName) => parseStatementSheet(workbook.Sheets[sheetName], sheetName, sourceFile))
    .filter(Boolean)
  return { detected: records.length > 0, records }
}
