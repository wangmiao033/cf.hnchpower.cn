/**
 * 研发账单 Excel 导出。
 * 每张账单生成一个正式对账单工作表，计算口径与页面保持一致。
 */

import * as XLSX from 'xlsx-js-style'
import dayjs from 'dayjs'
import {
  calculateRdSettlementAmount,
  calculateRdSettlementRow
} from '@/domain/settlement/calculateSettlementAmount.js'
import { isCorruptSettlementNumber } from '@/utils/settlementNumber.js'

const BLUE = '9DC3E6'
const DARK_BLUE = '5B9BD5'
const LIGHT_BLUE = 'EAF2F8'
const WHITE = 'FFFFFF'
const BLACK = '000000'
const RED = 'FF0000'

const DEFAULT_EXPORT_INFO = {
  mailingAddress: '王淼 18610308952 广州市天河区体育东路南方证券大厦21层2107-A门',
  invoice: {
    companyName: '广州熊动科技有限公司',
    taxRegistrationNo: '91440104MABURP0XXA',
    addressPhone: '广州市越秀区江月路13号之一301-自编390-16 13168368952',
    bankName: '中国工商银行股份有限公司广州兴华支行',
    bankAccount: '3602841509200157769'
  },
  payment: {
    companyName: '广州明朝互动科技股份有限公司',
    bankRoutingNo: '',
    bankName: '招商银行广州科技园支行',
    bankAccount: '120907560010604'
  }
}

const THIN_BORDER = {
  top: { style: 'thin', color: { rgb: BLACK } },
  bottom: { style: 'thin', color: { rgb: BLACK } },
  left: { style: 'thin', color: { rgb: BLACK } },
  right: { style: 'thin', color: { rgb: BLACK } }
}

function numeric(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function text(value) {
  return value == null ? '' : String(value).trim()
}

function firstText(...values) {
  for (const value of values) {
    const normalized = text(value)
    if (normalized) return normalized
  }
  return ''
}

function round2(value) {
  return Math.round(numeric(value) * 100) / 100
}

function normalizeMonth(value) {
  const raw = text(value)
  let match = raw.match(/^(\d{4})年(\d{1,2})月$/)
  if (!match) match = raw.match(/^(\d{4})[-/.](\d{1,2})$/)
  if (!match) return null
  return {
    year: Number(match[1]),
    month: Number(match[2])
  }
}

function monthNumber(value) {
  return normalizeMonth(value)?.month || ''
}

function settlementPeriod(value) {
  const normalized = normalizeMonth(value)
  if (!normalized) return text(value)
  const start = dayjs(`${normalized.year}-${String(normalized.month).padStart(2, '0')}-01`)
  return `${start.format('YYYY-MM-DD')} ~ ${start.endOf('month').format('YYYY-MM-DD')}`
}

function issueDate(record) {
  const candidate = firstText(record?.issueDate, record?.createdAt, record?.created_at)
  const date = candidate ? dayjs(candidate) : dayjs()
  return (date.isValid() ? date : dayjs()).format('YYYY/M/D')
}

function wrapGameName(name) {
  const value = text(name)
  if (!value) return ''
  return value.startsWith('《') ? value : `《${value}》`
}

function gameLineLabel(name, month) {
  const wrapped = wrapGameName(name)
  const monthLabel = monthNumber(month)
  if (!monthLabel || /[（(]\s*\d{1,2}\s*月\s*[）)]/.test(wrapped)) return wrapped
  return `${wrapped}（${monthLabel}月）`
}

function billTitle(record, expanded) {
  const names = [...new Set(expanded.map((row) => wrapGameName(row.game)).filter(Boolean))]
  const month = monthNumber(record?.settlementMonth || expanded[0]?.settlementMonth)
  const gamePart = names.join('、') || '研发'
  return `${gamePart}${month ? ` ${month}月` : ''}对账单`
}

function findPartner(record, partners) {
  const list = Array.isArray(partners) ? partners : []
  const id = text(record?.partnerId)
  const name = firstText(record?.partner, record?.partyBName)
  return (
    list.find((item) => id && text(item?.id) === id) ||
    list.find((item) => {
      const candidates = [item?.name, item?.shortName, item?.tag2].map(text).filter(Boolean)
      return name && candidates.includes(name)
    }) ||
    null
  )
}

function resolveExportInfo(record, options = {}) {
  const partner = findPartner(record, options.partners)
  const invoice = {
    ...DEFAULT_EXPORT_INFO.invoice,
    ...(options.invoice || {})
  }
  const paymentDefaults = {
    ...DEFAULT_EXPORT_INFO.payment,
    ...(options.payment || {})
  }
  const payment = {
    companyName: firstText(
      partner?.name,
      record?.partner,
      record?.partyBName,
      paymentDefaults.companyName
    ),
    bankRoutingNo: firstText(
      partner?.bankRoutingNo,
      partner?.bankCode,
      paymentDefaults.bankRoutingNo
    ),
    bankName: firstText(partner?.bankName, paymentDefaults.bankName),
    bankAccount: firstText(partner?.bankAccount, paymentDefaults.bankAccount)
  }
  return {
    mailingAddress: firstText(options.mailingAddress, DEFAULT_EXPORT_INFO.mailingAddress),
    invoice,
    payment
  }
}

/** 阿拉伯数字转中文大写金额。 */
export function toChineseUppercase(num) {
  const value = numeric(num)
  if (value === 0) return '零元整'
  const digits = '零壹贰叁肆伍陆柒捌玖'
  const units = ['', '拾', '佰', '仟']
  const sections = ['', '万', '亿', '兆']

  const integerToChinese = (integer) => {
    let valueToConvert = integer
    let sectionIndex = 0
    let result = ''
    let needsZero = false
    while (valueToConvert > 0) {
      const section = valueToConvert % 10000
      if (section === 0) {
        needsZero = result !== ''
      } else {
        let sectionValue = section
        let sectionText = ''
        let unitIndex = 0
        let zeroInside = false
        while (sectionValue > 0) {
          const digit = sectionValue % 10
          if (digit === 0) {
            if (sectionText && !zeroInside) zeroInside = true
          } else {
            const prefix = zeroInside ? '零' : ''
            sectionText = `${digits[digit]}${units[unitIndex]}${prefix}${sectionText}`
            zeroInside = false
          }
          unitIndex += 1
          sectionValue = Math.floor(sectionValue / 10)
        }
        if (needsZero && section < 1000) result = `零${result}`
        result = `${sectionText}${sections[sectionIndex]}${result}`
        needsZero = section < 1000
      }
      sectionIndex += 1
      valueToConvert = Math.floor(valueToConvert / 10000)
    }
    return result.replace(/零+/g, '零').replace(/零$/g, '')
  }

  const cents = Math.round(value * 100)
  const integer = Math.floor(cents / 100)
  const jiao = Math.floor((cents % 100) / 10)
  const fen = cents % 10
  const decimal =
    jiao || fen
      ? `${jiao ? `${digits[jiao]}角` : fen ? '零' : ''}${fen ? `${digits[fen]}分` : ''}`
      : '整'
  return `${integerToChinese(integer)}元${decimal}`
}

/** 多游戏账单展开为导出明细，保留页面现有计算口径。 */
export function expandRdRecordsForSettlementExport(records) {
  const list = Array.isArray(records) ? records : []
  const out = []
  for (const record of list) {
    const items = Array.isArray(record.items) && record.items.length > 0 ? record.items : [record]
    for (const line of items) {
      const calc = calculateRdSettlementRow(
        {
          revenue: line.revenue ?? record.gameFlow,
          discountRate: line.discountRate ?? record.discount,
          couponAmount: line.couponAmount ?? record.voucher,
          testFee: line.testFee ?? record.testingFee,
          extraFee: line.extraFee ?? record.refund,
          shareRatio: line.shareRatio ?? record.revenueShareRatio,
          taxRate: line.taxRate ?? record.taxPoint
        },
        record.channelFeeRate
      )
      out.push({
        settlementMonth: firstText(line.settlementCycle, record.settlementMonth),
        game: firstText(line.gameName, record.game),
        revenue: numeric(line.revenue ?? record.gameFlow),
        discountedFlow: calc.totalFlow,
        technicalBug: numeric(line.technicalBug ?? line.techBug ?? record.technicalBug),
        abnormalRefund: numeric(line.abnormalRefund ?? line.extraFee ?? record.refund),
        selfRecharge: numeric(line.selfRecharge ?? record.selfRecharge),
        testingFee: numeric(line.testFee ?? record.testingFee),
        voucher: numeric(line.couponAmount ?? record.voucher),
        channelFeeRate: numeric(record.channelFeeRate),
        taxPoint: numeric(line.taxRate ?? record.taxPoint),
        revenueShareRatio: numeric(line.shareRatio ?? record.revenueShareRatio),
        shareAmount: calc.shareAmount,
        settlementAmount: calculateRdSettlementAmount(
          {
            revenue: line.revenue ?? record.gameFlow,
            discountRate: line.discountRate ?? record.discount,
            couponAmount: line.couponAmount ?? record.voucher,
            testFee: line.testFee ?? record.testingFee,
            extraFee: line.extraFee ?? record.refund,
            shareRatio: line.shareRatio ?? record.revenueShareRatio,
            taxRate: line.taxRate ?? record.taxPoint
          },
          record.channelFeeRate
        ),
        remark: firstText(line.remark, line.memo)
      })
    }
  }
  return out
}

function total(expanded, field) {
  return round2(expanded.reduce((sum, row) => sum + numeric(row[field]), 0))
}

function invoiceInfoText(info) {
  return [
    `纳税人名称：${info.companyName}`,
    `纳税人识别号（社会信用代码）：${info.taxRegistrationNo}`,
    `注册地址、电话：${info.addressPhone}`,
    `开户银行、账号：${info.bankName} ${info.bankAccount}`
  ].join('\n')
}

function paymentInfoText(info) {
  return [
    `企业名称：${info.companyName}`,
    `支付联行号（开户行号）：${info.bankRoutingNo}`,
    `开户银行：${info.bankName}`,
    `收款账号：${info.bankAccount}`
  ].join('\n')
}

/**
 * 构建正式研发对账单二维数据。
 * 为保持兼容，第二个参数可省略。
 */
export function buildSettlementSheetAoa(records, options = {}) {
  const safe = Array.isArray(records) ? records.filter(Boolean) : []
  const record = safe[0] || {}
  const expanded = expandRdRecordsForSettlementExport(safe)
  const info = resolveExportInfo(record, options)
  const detailRowCount = Math.max(expanded.length, 5)
  const rows = Array.from({ length: 23 + Math.max(0, detailRowCount - 5) }, () => Array(14).fill(''))

  rows[1][0] = '账单名称'
  rows[1][1] = billTitle(record, expanded)
  rows[1][13] = '备注'
  rows[2][0] = '出单时间'
  rows[2][1] = issueDate(record)
  rows[3][0] = '结算账期'
  rows[3][1] = settlementPeriod(record.settlementMonth || expanded[0]?.settlementMonth)
  rows[4][0] = '邮寄地址'
  rows[4][1] = info.mailingAddress

  rows[6] = [
    '游戏名称',
    '充值流水',
    '折后流水',
    '技术BUG',
    '异常退款',
    '自充金额',
    '测试费',
    '代金券',
    '通道费',
    '代扣税率',
    '参与分成金额',
    '分成比例',
    '结算金额',
    '备注'
  ]

  expanded.forEach((line, index) => {
    rows[7 + index] = [
      gameLineLabel(line.game, line.settlementMonth),
      round2(line.revenue),
      round2(line.discountedFlow),
      round2(line.technicalBug),
      round2(line.abnormalRefund),
      round2(line.selfRecharge),
      round2(line.testingFee),
      round2(line.voucher),
      line.channelFeeRate / 100,
      line.taxPoint / 100,
      round2(line.shareAmount),
      line.revenueShareRatio / 100,
      round2(line.settlementAmount),
      line.remark
    ]
  })

  const summaryStart = 7 + detailRowCount
  rows[summaryStart][10] = total(expanded, 'shareAmount')
  rows[summaryStart + 1][10] = '充值流水'
  rows[summaryStart + 1][12] = total(expanded, 'settlementAmount')
  rows[summaryStart + 2][0] = '实际结算金额合计：'
  rows[summaryStart + 2][12] = total(expanded, 'settlementAmount')

  const minorsHeader = summaryStart + 4
  rows[minorsHeader][0] = '涉及未成年退款渠道'
  rows[minorsHeader][13] = '备注'
  rows[minorsHeader + 1][0] = '渠道'
  rows[minorsHeader + 1][1] = '金额'
  rows[minorsHeader + 1][3] = 0

  const uppercaseRow = minorsHeader + 3
  rows[uppercaseRow][0] = '结算金额（人民币大写）'
  rows[uppercaseRow][2] = toChineseUppercase(total(expanded, 'settlementAmount'))

  const noticeRow = uppercaseRow + 1
  rows[noticeRow][0] = '重要说明'
  rows[noticeRow][2] = [
    '1、表格中的确认/待填内容请及时核对，避免付款延迟；',
    `2、确认后请盖章并邮寄至：${info.mailingAddress}；`,
    '3、如提供电子发票请打印2份，电子发票源文件发送至 caiwu@dxyx6888.com；',
    '4、结算流程：【确认账单—邮寄发票及对账单】；',
    '5、结算日：每月固定20至28号，未收到款项可联系 18610308952。'
  ].join('\n')

  const infoHeaderRow = noticeRow + 1
  rows[infoHeaderRow][0] = '开票信息'
  rows[infoHeaderRow][6] = '收款信息/避免付款延迟，请尽快填写相关收款信息'
  rows[infoHeaderRow + 1][0] = invoiceInfoText(info.invoice)
  rows[infoHeaderRow + 1][6] = paymentInfoText(info.payment)

  return rows
}

function findRow(ws, label, column = 0) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    if (ws[XLSX.utils.encode_cell({ r: row, c: column })]?.v === label) return row
  }
  return -1
}

function setCellStyle(ws, row, column, style) {
  const address = XLSX.utils.encode_cell({ r: row, c: column })
  if (!ws[address]) ws[address] = { t: 's', v: '' }
  ws[address].s = style
}

function styleRange(ws, startRow, endRow, startColumn, endColumn, style) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      setCellStyle(ws, row, column, style)
    }
  }
}

function merge(ws, startRow, startColumn, endRow, endColumn) {
  ws['!merges'].push({
    s: { r: startRow, c: startColumn },
    e: { r: endRow, c: endColumn }
  })
}

/** 应用参考模板的正式版式。 */
export function applySettlementSheetLayout(ws) {
  const headerRow = 6
  const actualTotalRow = findRow(ws, '实际结算金额合计：')
  const minorsHeaderRow = findRow(ws, '涉及未成年退款渠道')
  const uppercaseRow = findRow(ws, '结算金额（人民币大写）')
  const noticeRow = findRow(ws, '重要说明')
  const infoHeaderRow = findRow(ws, '开票信息')
  const infoContentRow = infoHeaderRow + 1
  const detailEndRow = actualTotalRow - 3

  ws['!cols'] = [
    { wch: 31 },
    { wch: 17 },
    { wch: 13 },
    { wch: 8 },
    { wch: 11 },
    { wch: 11 },
    { wch: 9 },
    { wch: 10 },
    { wch: 9 },
    { wch: 10 },
    { wch: 15 },
    { wch: 10 },
    { wch: 15 },
    { wch: 19 }
  ]
  ws['!rows'] = []
  ;[1, 2, 3, 4].forEach((row) => {
    ws['!rows'][row] = { hpt: 22 }
  })
  ws['!rows'][headerRow] = { hpt: 36 }
  for (let row = headerRow + 1; row <= detailEndRow; row += 1) {
    ws['!rows'][row] = { hpt: 23 }
  }
  ws['!rows'][noticeRow] = { hpt: 100 }
  ws['!rows'][infoContentRow] = { hpt: 108 }

  ws['!merges'] = []
  ;[1, 2, 3, 4].forEach((row) => merge(ws, row, 1, row, 12))
  merge(ws, minorsHeaderRow, 0, minorsHeaderRow, 12)
  merge(ws, minorsHeaderRow + 1, 1, minorsHeaderRow + 1, 2)
  merge(ws, uppercaseRow, 0, uppercaseRow, 1)
  merge(ws, uppercaseRow, 2, uppercaseRow, 13)
  merge(ws, noticeRow, 0, noticeRow, 1)
  merge(ws, noticeRow, 2, noticeRow, 12)
  merge(ws, infoHeaderRow, 0, infoHeaderRow, 5)
  merge(ws, infoHeaderRow, 6, infoHeaderRow, 12)
  merge(ws, infoContentRow, 0, infoContentRow, 5)
  merge(ws, infoContentRow, 6, infoContentRow, 12)

  const baseStyle = {
    font: { name: 'Microsoft YaHei', sz: 10, color: { rgb: BLACK } },
    fill: { fgColor: { rgb: WHITE } },
    alignment: { vertical: 'center', wrapText: true },
    border: THIN_BORDER
  }
  const centered = {
    ...baseStyle,
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
  }
  const labelStyle = {
    ...centered,
    font: { name: 'Microsoft YaHei', sz: 10, bold: true, color: { rgb: BLACK } }
  }
  const headerStyle = {
    ...labelStyle,
    fill: { fgColor: { rgb: BLUE } }
  }
  const sectionStyle = {
    ...labelStyle,
    fill: { fgColor: { rgb: DARK_BLUE } }
  }

  styleRange(ws, 0, infoContentRow, 0, 13, baseStyle)
  styleRange(ws, 1, 4, 0, 0, labelStyle)
  styleRange(ws, 1, 1, 13, 13, headerStyle)
  styleRange(ws, headerRow, headerRow, 0, 13, headerStyle)
  styleRange(ws, minorsHeaderRow, minorsHeaderRow, 0, 13, sectionStyle)
  styleRange(ws, uppercaseRow, uppercaseRow, 0, 13, labelStyle)
  styleRange(ws, noticeRow, noticeRow, 0, 13, {
    ...baseStyle,
    fill: { fgColor: { rgb: BLUE } },
    font: { name: 'Microsoft YaHei', sz: 10, bold: true, color: { rgb: BLACK } },
    alignment: { vertical: 'center', wrapText: true }
  })
  styleRange(ws, infoHeaderRow, infoHeaderRow, 0, 13, labelStyle)
  styleRange(ws, infoContentRow, infoContentRow, 0, 13, {
    ...baseStyle,
    font: { name: 'Microsoft YaHei', sz: 10, bold: true, color: { rgb: BLACK } },
    alignment: { vertical: 'center', wrapText: true }
  })

  for (let row = headerRow + 1; row <= detailEndRow; row += 1) {
    styleRange(ws, row, row, 1, 12, centered)
    ;[1, 2, 4, 8, 11].forEach((column) => {
      const address = XLSX.utils.encode_cell({ r: row, c: column })
      ws[address].s = {
        ...ws[address].s,
        fill: { fgColor: { rgb: LIGHT_BLUE } }
      }
    })
    ;[1, 2, 3, 4, 5, 6, 7, 10, 12].forEach((column) => {
      const address = XLSX.utils.encode_cell({ r: row, c: column })
      ws[address].z = '#,##0.00'
    })
    ;[8, 9, 11].forEach((column) => {
      const address = XLSX.utils.encode_cell({ r: row, c: column })
      ws[address].z = '0%'
    })
  }

  styleRange(ws, actualTotalRow - 1, actualTotalRow, 10, 12, labelStyle)
  ws[XLSX.utils.encode_cell({ r: actualTotalRow - 1, c: 12 })].z = '#,##0.00'
  ws[XLSX.utils.encode_cell({ r: actualTotalRow, c: 12 })].z = '¥#,##0.00'

  const noticeCell = ws[XLSX.utils.encode_cell({ r: noticeRow, c: 2 })]
  noticeCell.s = {
    ...noticeCell.s,
    font: { name: 'Microsoft YaHei', sz: 10, bold: true, color: { rgb: BLACK } }
  }

  ws['!pageSetup'] = {
    orientation: 'landscape',
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    horizontalCentered: true
  }
  ws['!margins'] = {
    left: 0.2,
    right: 0.2,
    top: 0.35,
    bottom: 0.35,
    header: 0.15,
    footer: 0.15
  }
  ws['!autofilter'] = undefined

  const remarkCell = ws.N2
  if (remarkCell) {
    remarkCell.s = {
      ...headerStyle,
      font: { name: 'Microsoft YaHei', sz: 10, bold: true, color: { rgb: BLACK } }
    }
  }
  const titleCell = ws.B2
  if (titleCell) {
    titleCell.s = {
      ...baseStyle,
      font: { name: 'Microsoft YaHei', sz: 11, bold: true, color: { rgb: BLACK } }
    }
  }
  const redTextCell = ws[XLSX.utils.encode_cell({ r: noticeRow, c: 13 })]
  if (redTextCell) {
    redTextCell.s = {
      ...redTextCell.s,
      font: { name: 'Microsoft YaHei', sz: 10, color: { rgb: RED } },
      fill: { fgColor: { rgb: BLUE } }
    }
  }
}

/** Excel sheet 名合法且不超过 31 字符。 */
export function sanitizeExcelSheetName(raw) {
  let source = raw
  if (source != null && isCorruptSettlementNumber(String(source))) source = '研发账单'
  const normalized = String(source || '研发账单')
    .replace(/[:\\/?*[\]]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.slice(0, 31) || '研发账单'
}

function allocateUniqueSheetNames(records) {
  const used = new Set()
  return records.map((record, index) => {
    const base = sanitizeExcelSheetName(record.settlementNumber || `研发账单${index + 1}`)
    let name = base
    let suffixIndex = 1
    while (used.has(name)) {
      const suffix = `_${suffixIndex++}`
      name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`
    }
    used.add(name)
    return name
  })
}

function sanitizeFileSegment(raw) {
  return String(raw || '')
    .trim()
    .replace(/[/\\?*:[\]"<>|]/g, '_')
    .slice(0, 80)
}

/**
 * 按勾选顺序生成工作簿；每条研发账单一个工作表。
 */
export function buildSettlementWorkbookFromSelected(selectedRecords, options = {}) {
  const list = Array.isArray(selectedRecords) ? selectedRecords.filter(Boolean) : []
  if (list.length === 0) throw new Error('NO_RECORDS')

  const workbook = XLSX.utils.book_new()
  const names = allocateUniqueSheetNames(list)
  list.forEach((record, index) => {
    const data = buildSettlementSheetAoa([record], options)
    const worksheet = XLSX.utils.aoa_to_sheet(data)
    applySettlementSheetLayout(worksheet)
    XLSX.utils.book_append_sheet(workbook, worksheet, names[index])
  })

  if (list.length === 1) {
    const record = list[0]
    const month = monthNumber(record.settlementMonth)
    const gameNames = expandRdRecordsForSettlementExport([record])
      .map((row) => text(row.game).replace(/[《》]/g, ''))
      .filter(Boolean)
      .join('、')
    const descriptor = sanitizeFileSegment(gameNames || record.settlementNumber || '研发账单')
    return {
      wb: workbook,
      fileName: `《${descriptor}》${month ? `${month}月` : ''}对账单.xlsx`
    }
  }

  return {
    wb: workbook,
    fileName: `研发账单_批量导出_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`
  }
}

export function writeSettlementWorkbookToFile(workbook, fileName) {
  XLSX.writeFile(workbook, fileName, { cellStyles: true, bookType: 'xlsx' })
}
