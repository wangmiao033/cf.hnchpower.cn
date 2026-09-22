import { describe, expect, it } from 'vitest'
import { parsePayrollRows } from './payrollImport.js'

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
