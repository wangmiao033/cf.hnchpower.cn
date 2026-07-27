const COMPLETED_TEXT = '已完成'

function cleanText(value) {
  return value == null ? '' : String(value).trim()
}

function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(cleanText(value).replace(/[¥￥,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function percent(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0
}

function findColumn(headers, names, fallback) {
  for (const name of names) {
    const index = headers.findIndex((header) => cleanText(header) === name)
    if (index >= 0) return index
  }
  return fallback
}

export function extractChannelProgressMonth(fileName = '', sheetName = '') {
  const fileMatch = cleanText(fileName).match(/(20\d{2})年?(\d{1,2})/)
  if (fileMatch) {
    return `${fileMatch[1]}-${String(Number(fileMatch[2])).padStart(2, '0')}`
  }

  const sheetMatch = cleanText(sheetName).match(/^(\d{2})(\d{2})$/)
  if (sheetMatch) return `20${sheetMatch[1]}-${sheetMatch[2]}`
  return ''
}

export function summarizeChannelProgressMatrix(matrix, options = {}) {
  if (!Array.isArray(matrix) || matrix.length < 2) {
    throw new Error('进度表没有可读取的数据')
  }

  const headerRowIndex = matrix.findIndex((row) =>
    Array.isArray(row) && row.some((cell) => cleanText(cell) === '对账进度')
  )
  if (headerRowIndex < 0) {
    throw new Error('未找到“对账进度”列，请选择渠道对账源表')
  }

  const headers = matrix[headerRowIndex].map(cleanText)
  const productIndex = findColumn(headers, ['产品', '游戏', '游戏名称'], 0)
  const channelIndex = findColumn(headers, ['渠道', '渠道名称'], 1)
  const flowIndex = findColumn(headers, ['流水', '充值流水', '计费流水'], 2)
  const backendBillIndex = findColumn(headers, ['后台账单'], 21)
  const varianceIndex = findColumn(headers, ['核对', '差异'], 22)
  const reconcileIndex = findColumn(headers, ['对账进度'], 24)
  const receivableIndex = findColumn(headers, ['登应收出账单', '应收出账单'], 25)

  const rows = matrix
    .slice(headerRowIndex + 1)
    .map((cells, index) => {
      const sourceFlow = numberValue(cells?.[flowIndex])
      const reconciliationStatus = cleanText(cells?.[reconcileIndex])
      const receivableStatus = cleanText(cells?.[receivableIndex])
      return {
        id: `source-${headerRowIndex + index + 2}`,
        rowNumber: headerRowIndex + index + 2,
        product: cleanText(cells?.[productIndex]) || '未命名产品',
        channel: cleanText(cells?.[channelIndex]) || '未命名渠道',
        sourceFlow,
        backendBill: numberValue(cells?.[backendBillIndex]),
        variance: numberValue(cells?.[varianceIndex]),
        reconciliationStatus,
        receivableStatus,
        isReconciled: reconciliationStatus === COMPLETED_TEXT,
        isReceivablePosted: receivableStatus === COMPLETED_TEXT
      }
    })
    .filter((row) => row.product !== '未命名产品' || row.channel !== '未命名渠道' || row.sourceFlow)

  if (rows.length === 0) throw new Error('进度表没有有效流水行')

  const sum = (items, field) =>
    items.reduce((total, row) => total + numberValue(row[field]), 0)
  const reconciledRows = rows.filter((row) => row.isReconciled)
  const receivableRows = rows.filter((row) => row.isReceivablePosted)
  const unresolved = rows
    .filter((row) => !row.isReconciled)
    .sort((a, b) => b.sourceFlow - a.sourceFlow)

  const sourceFlow = sum(rows, 'sourceFlow')
  const reconciledFlow = sum(reconciledRows, 'sourceFlow')
  const receivableFlow = sum(receivableRows, 'sourceFlow')

  return {
    version: 1,
    fileName: options.fileName || '渠道对账进度表',
    sheetName: options.sheetName || '',
    month:
      options.month ||
      extractChannelProgressMonth(options.fileName, options.sheetName),
    importedAt: options.importedAt || new Date().toISOString(),
    totals: {
      rows: rows.length,
      sourceFlow,
      reconciledRows: reconciledRows.length,
      reconciledFlow,
      reconciliationAmountPercent: percent(reconciledFlow, sourceFlow),
      reconciliationRowPercent: percent(reconciledRows.length, rows.length),
      receivableRows: receivableRows.length,
      receivableFlow,
      receivableAmountPercent: percent(receivableFlow, sourceFlow),
      receivableRowPercent: percent(receivableRows.length, rows.length),
      unresolvedRows: unresolved.length,
      unresolvedFlow: sum(unresolved, 'sourceFlow')
    },
    unresolved
  }
}

export const CHANNEL_PROGRESS_PREVIEW = {
  version: 1,
  fileName: '【财务-渠道对账】2026年6 (1).xlsx',
  sheetName: '2606',
  month: '2026-06',
  importedAt: '2026-07-27T12:00:00.000Z',
  totals: {
    rows: 112,
    sourceFlow: 25442132.94,
    reconciledRows: 105,
    reconciledFlow: 25392390.94,
    reconciliationAmountPercent: 99.8044896624,
    reconciliationRowPercent: 93.75,
    receivableRows: 105,
    receivableFlow: 25392390.94,
    receivableAmountPercent: 99.8044896624,
    receivableRowPercent: 93.75,
    unresolvedRows: 7,
    unresolvedFlow: 49742
  },
  unresolved: [
    {
      id: 'source-90',
      rowNumber: 90,
      product: '圣树唤歌005',
      channel: '果盘66(XX助手)',
      sourceFlow: 44612,
      backendBill: 0,
      variance: -63.57
    },
    {
      id: 'source-45',
      rowNumber: 45,
      product: '仙帝神兵',
      channel: '大熊游戏',
      sourceFlow: 3246,
      backendBill: 0,
      variance: -1541.85
    },
    {
      id: 'source-8',
      rowNumber: 8,
      product: '六界仙尊',
      channel: 'OPPO',
      sourceFlow: 1344,
      backendBill: 0,
      variance: -638.4
    },
    {
      id: 'source-29',
      rowNumber: 29,
      product: '仙帝神兵',
      channel: 'OPPO',
      sourceFlow: 354,
      backendBill: 0,
      variance: -168.15
    },
    {
      id: 'source-31',
      rowNumber: 31,
      product: '仙帝神兵',
      channel: '果盘（XX助手）',
      sourceFlow: 96,
      backendBill: 0,
      variance: -45.6
    },
    {
      id: 'source-11',
      rowNumber: 11,
      product: '六界仙尊',
      channel: '大熊游戏',
      sourceFlow: 84,
      backendBill: 0,
      variance: 0
    },
    {
      id: 'source-39',
      rowNumber: 39,
      product: '仙帝神兵',
      channel: '3011游戏',
      sourceFlow: 6,
      backendBill: 0,
      variance: 0
    }
  ]
}
