import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseChannelStatementWorkbook } from './channelStatementImport.js'

describe('3733 渠道月结单导入', () => {
  it('把一个月份的多游戏明细合并为一张渠道账单', () => {
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([
      ['', '', '2026年06月 结算对账单'],
      ['致：广州能动科技有限公司'],
      [],
      ['序号', '实际结算日期', '游戏名字', '月充值', '测试流水', '代金券', '金币', '退款', '分成比例', '渠道费', '税点', '结算金额', '备注'],
      [1, '6.01-6.30', '一起来修仙（0.05折）', 15887.105, 0, 0, 0, 0, 0.25, 0, 0, 3971.77625, ''],
      [2, '6.01-6.30', '龙吟大陆', 2448.26, 0, 0, 0, 0, 0.3, 0, 0, 734.478, ''],
      ['合计', '', '', 18335.365, '', '', '', '', '', '', '', 4706.25425],
      [],
      ['开票名称：厦门三七三三网络科技有限公司']
    ])
    XLSX.utils.book_append_sheet(workbook, sheet, '202606')

    const result = parseChannelStatementWorkbook(workbook, '3733.xlsx')
    expect(result.detected).toBe(true)
    expect(result.records).toHaveLength(1)
    const record = result.records[0]
    expect(record.channelName).toBe('厦门三七三三网络科技有限公司')
    expect(record.partnerName).toBe('广州能动科技有限公司')
    expect(record.settlementMonth).toBe('2026-06')
    expect(record.items).toHaveLength(2)
    expect(record.items[0].flow).toBe(15887.105)
    expect(record.items[0].discountFactor).toBe(1)
    expect(record.items[0].shareRate).toBe(25)
    expect(record.items[1].shareRate).toBe(30)
    expect(record.flow).toBeCloseTo(18335.37, 2)
    expect(record.settlementAmount).toBe(4706.25425)
  })
})
