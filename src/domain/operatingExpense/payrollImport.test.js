import { describe, expect, it } from 'vitest'
import { markExistingPayrollBatches, parsePayrollRows, parsePayrollWorkbookSheets } from './payrollImport.js'

describe('payroll Excel import', () => {
  it('parses the current salary template and verifies formulas', () => {
    const rows = [
      [null, '2026 年 八 月 工 资 表'],
      [],
      [null, '姓名', '入职时间', '工龄', '出勤天数', '基本工资', '实际工资', '补偿', '全勤奖金', '调薪记录', '奖金', '试用期薪资', '生日经费', '体检经费', '税前工资', '补税', '养老保险', '医疗保险', '失业保险', '公积金', '请假扣除', '迟到罚款', '小计', '个税', '税后实发', '备注'],
      [null, '示例员工', null, 2, 21, 7000, 7000, null, null, null, 250, null, null, null, 7250, 0, 440.8, 124.68, 5, 0, 0, 0, 570.48, 50.38, 6629.14, null],
      [null, '合计', null, null, null, null, null, null, null, null, null, null, null, null, 7250, null, 440.8, 124.68, 5, 0, 0, 0, 570.48, 50.38, 6629.14, null]
    ]
    const result = parsePayrollRows(rows, '广州超凡响应网络科技有限公司工资表.xlsx')
    expect(result.expenseMonth).toBe('2026-08')
    expect(result.companyName).toBe('广州超凡响应网络科技有限公司')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].deduction_total).toBe(570.48)
    expect(result.items[0].net_salary).toBe(6629.14)
    expect(result.items[0].validation_status).toBe('valid')
    expect(result.totals.gross_salary).toBe(7250)
  })

  it('marks a row when deduction or net salary does not match the formulas', () => {
    const rows = [
      ['2026年8月工资表'],
      ['姓名', '税前工资', '养老保险', '医疗保险', '失业保险', '公积金', '小计', '个税', '税后实发'],
      ['示例员工', 10000, 400, 100, 5, 1000, 1400, 100, 8500]
    ]
    const result = parsePayrollRows(rows)
    expect(result.items[0].validation_status).toBe('mismatch')
    expect(result.validationStatus).toBe('mismatch')
  })
})


const COMPANY_XD = '广州熊动科技有限公司'
const COMPANY_CF = '广州超凡响应网络科技有限公司'

function payrollSheet(company, month, entries) {
  const rows = [
    [`${company} ${month}月 2026 工资表`],
    ['根据原工资表截图转录'],
    ['序号','姓名','应发工资','养老保险','医疗保险','失业保险','公积金','代扣小计','个人所得税','实发工资合计','签名/日期'],
    ...entries.map(([name, gross, tax, housing = 0], index) => {
      const deduction = Math.round((440.8 + 124.68 + 5 + housing) * 100) / 100
      return [index + 1, name, gross, 440.8, 124.68, 5, housing, deduction, tax,
        Math.round((gross - deduction - tax) * 100) / 100, null]
    }),
    ['合计']
  ]
  return { name: `${company === COMPANY_XD ? '熊动' : '超凡'}_2026-${String(month).padStart(2,'0')}`, rows }
}

describe('5—8 月双公司整本工资表导入', () => {
  const workbooks = [
    { name: '导入说明', rows: [['2026年5—8月工资 | 双公司批量导入'], ['工资月份','公司','人数']] },
    payrollSheet(COMPANY_XD, 5, [['王淼',15000,822.95,1200]]),
    payrollSheet(COMPANY_CF, 5, [['龚辉',7250,50.39],['罗汉金',5500,0],['吴伟滨',5150,0],['马纯敏',6250,0]]),
    payrollSheet(COMPANY_XD, 6, [['王淼',15000,822.95,1200]]),
    payrollSheet(COMPANY_CF, 6, [['龚辉',7250,50.38],['罗汉金',5500,0],['吴伟滨',4900,0],['马纯敏',6000,0]]),
    payrollSheet(COMPANY_XD, 7, [['王淼',15000,822.95,1200]]),
    payrollSheet(COMPANY_CF, 7, [['龚辉',7250,50.39],['罗汉金',5750,1.16],['吴伟滨',5150,0],['马纯敏',6000,0]]),
    payrollSheet(COMPANY_XD, 8, [['王淼',15000,822.95,1200]]),
    payrollSheet(COMPANY_CF, 8, [['龚辉',7250,50.38],['罗汉金',5500,0],['吴伟滨',5150,0],['马纯敏',6000,0]])
  ]

  it('skips the first explanatory worksheet and parses all eight payroll batches', () => {
    const batches = parsePayrollWorkbookSheets(workbooks, '2026年05-08月_两家公司工资批量导入.xlsx')
    expect(batches).toHaveLength(8)
    expect(batches.map(x => x.expenseMonth)).toEqual([
      '2026-05','2026-05','2026-06','2026-06','2026-07','2026-07','2026-08','2026-08'
    ])
    expect(batches.map(x => x.companyName)).toEqual([
      COMPANY_XD,COMPANY_CF,COMPANY_XD,COMPANY_CF,COMPANY_XD,COMPANY_CF,COMPANY_XD,COMPANY_CF
    ])
    expect(batches.map(x => x.items.length)).toEqual([1,4,1,4,1,4,1,4])
    expect(batches.every(x=>x.validationStatus==='valid')).toBe(true)
    expect(batches.filter(x=>x.error)).toHaveLength(0)
    expect(batches.filter(x=>x.items.length===4).map(x=>x.totals.net_salary_total))
      .toEqual([21817.69,21317.70,21816.53,21567.70])
  })

  it('recognizes 2026-08 in the workbook sheet title and a reversed 5月 2026 title', () => {
    const fromSheet = parsePayrollRows([['工资明细'],['姓名','应发工资','实发工资'],['员工',100,100]], '熊动_2026-08.xlsx')
    expect(fromSheet.expenseMonth).toBe('2026-08')
    const reversed = parsePayrollRows([['广州熊动科技有限公司 5月 2026 工资表'],['姓名','应发工资','实发工资'],['员工',100,100]])
    expect(reversed.expenseMonth).toBe('2026-05')
    expect(reversed.companyName).toBe(COMPANY_XD)
  })

  it('reports 8 月 difference instead of overwriting existing payroll', () => {
    const batches = parsePayrollWorkbookSheets(workbooks,'batch.xlsx').map((b,i)=>({
      ...b,key:String(i),payrollStatus:'pending_review'
    }))
    const existing = [
      {expense_month:'2026-08',company_name:COMPANY_XD,net_salary_total:12406.57},
      {expense_month:'2026-08',company_name:COMPANY_CF,net_salary_total:21566.53}
    ]
    const marked = markExistingPayrollBatches(batches,existing)
    expect(marked.filter(x=>x.existingBatch)).toHaveLength(2)
    expect(marked.filter(x=>!x.existingBatch)).toHaveLength(6)
    expect(marked[7].existingNetDifference).toBe(1.17)
  })

  it('does not classify an instruction-only or summary-only workbook as payroll', () => {
    expect(()=>parsePayrollWorkbookSheets([{name:'导入说明',rows:[['说明']]}],'all.xlsx')).toThrow('未在 Excel 中找到工资明细工作表')
  })
})
