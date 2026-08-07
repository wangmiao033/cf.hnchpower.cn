import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseTaxInvoiceWorkbook } from './taxInvoiceExcelImport.js'

function workbookWithSheet(name, rows) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name)
  return workbook
}

describe('税务 Excel 发票导入', () => {
  it('识别抵扣勾选表为进项发票并保留抵扣与风险信息', () => {
    const workbook = workbookWithSheet('sheet1', [
      ['序号', '是否勾选*', '数电发票号码', '开票日期*', '金额*', '票面税额*', '有效抵扣税额*', '购买方识别号*', '销售方纳税人名称', '销售方纳税人识别号', '发票来源', '票种*', '发票状态', '红字锁定标志', '发票风险等级', '风险状态'],
      [1, '否', '26117000001134616865', '2026-07-30 11:37:34', '145.51', '13.10', '13.10', '91440104MABURP0XXA', '阿里巴巴云计算（北京）有限公司', '91110108769914581E', '电子发票服务平台', '数电发票（增值税专用发票）', '正常', '未锁定', '正常', '无风险']
    ])

    const result = parseTaxInvoiceWorkbook(workbook, '抵扣勾选.xlsx', XLSX.utils)
    expect(result.type).toBe('input_deduction')
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      invoiceDirection: 'input',
      digitalInvoiceNo: '26117000001134616865',
      sellerName: '阿里巴巴云计算（北京）有限公司',
      amount: '145.51',
      taxAmount: '13.10',
      amountWithTax: '158.61',
      issueDate: '2026-07-30',
      status: '已开',
      taxStatus: 'normal',
      invoiceIdentityKey: 'digital:26117000001134616865'
    })
    expect(result.records[0].remark).toContain('抵扣勾选：否')
    expect(result.records[0].remark).toContain('有效抵扣税额：13.10')
  })

  it('优先使用发票基础信息解析销项并标记红冲', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['序号', '数电发票号码', '金额'],
      [1, 'detail-should-not-be-used', 999]
    ]), '信息汇总表')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['序号', '数电发票号码', '销方识别号', '销方名称', '购方识别号', '购买方名称', '开票日期', '金额', '税额', '价税合计', '发票来源', '发票票种', '发票状态', '是否正数发票', '发票风险等级', '开票人', '备注'],
      [1, '26442000008015786206', '91440104MABURP0XXA', '广州熊动科技有限公司', '91350200MA33HHD072', '厦门三七三三网络科技有限公司', '2026-07-14 17:22:15', 4439.86, 266.39, 4706.25, '电子发票服务平台', '数电发票（增值税专用发票）', '正常', '是', '正常', '马纯敏', ''],
      [2, '26442000008419337986', '91440104MABURP0XXA', '广州熊动科技有限公司', '91330302MA29A6CE0J', '温州赏金猎人网络科技有限公司', '2026-07-23 16:31:52', -178.55, -10.71, -189.26, '电子发票服务平台', '数电发票（增值税专用发票）', '正常', '否', '正常', '马纯敏', '被红冲蓝字数电发票号码：26442000008413305781']
    ]), '发票基础信息')

    const result = parseTaxInvoiceWorkbook(workbook, '全量发票.xlsx', XLSX.utils)
    expect(result.type).toBe('output_full_query')
    expect(result.records).toHaveLength(2)
    expect(result.records[0]).toMatchObject({
      invoiceDirection: 'output',
      buyerName: '厦门三七三三网络科技有限公司',
      amountWithTax: '4706.25',
      taxStatus: 'normal'
    })
    expect(result.records[1].taxStatus).toBe('red')
    expect(result.records[1].amountWithTax).toBe('-189.26')
  })

  it('拒绝无法识别的 Excel 模板', () => {
    const result = parseTaxInvoiceWorkbook(
      workbookWithSheet('Sheet1', [['foo'], ['bar']]),
      'x.xlsx',
      XLSX.utils
    )
    expect(result.detected).toBe(false)
    expect(result.records).toEqual([])
  })
})