import { describe, expect, it } from 'vitest'
import { icbcRowToBankTransaction, parseIcbcStatementMatrix } from './icbcStatementExcel.js'

describe('工商银行 Excel 流水解析', () => {
  it('识别工行标准借贷列并保留余额', () => {
    const matrix = [
      ['日期', '借贷标志', '对方单位', '用途', '摘要', '附言', '转出金额', '转入金额', '余额'],
      [new Date(2026, 5, 30), '贷', '厦门游戏之家科技有限公司', '', 'CWDG26062482', 'CWDG26062482', '', '10,359.68', '200,128.82'],
      [new Date(2026, 5, 24), '借', '广州住房公积金管理中心', '', '1201045633', '1201045633', '2,400.00', '', '176,633.90']
    ]

    const parsed = parseIcbcStatementMatrix(matrix)
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.summary.incomeTotal).toBe(10359.68)
    expect(parsed.summary.expenseTotal).toBe(2400)
    expect(parsed.rows[0].tradeDate).toBe('2026-06-30')
    expect(parsed.rows[0].direction).toBe('credit')
    expect(parsed.rows[0].balance).toBe(200128.82)
    expect(parsed.rows[1].direction).toBe('debit')
  })

  it('按收入/支出方向映射交易对手', () => {
    const income = icbcRowToBankTransaction({
      sourceRowNo: 2,
      tradeDate: '2026-06-30',
      direction: 'credit',
      counterparty: '渠道公司',
      counterpartyAccount: '',
      incomeAmount: 100,
      expenseAmount: null,
      balance: 1000,
      summary: '结算款',
      purpose: '',
      remark: '',
      transactionNo: '',
      rawText: ''
    }, { sourceBank: 'ICBC', fileName: 'test.xlsx' })

    expect(income.payer_name).toBe('渠道公司')
    expect(income.payee_name).toBeNull()
    expect(income.income_amount).toBe(100)
    expect(income.balance).toBe(1000)
    expect(income.source_file_name).toBe('test.xlsx')
  })
})
