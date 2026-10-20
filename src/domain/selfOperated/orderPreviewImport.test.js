import {describe,it,expect} from 'vitest'
import {
  detectOrderHeader,suggestFieldMapping,getMissingMapping,
  readAmountCents,normalizePaidDate,inspectOrderRows,reportFromInspectedRows,parseDelimitedText
} from './orderPreviewImport.js'

const headers=['订单编号','游戏名称','游戏ID','实际支付金额','支付时间','支付状态','业务类型']
const rows=[headers,
 ['BX001','帝国雄师','893','¥1,000.80','2026-09-01 12:34:00','支付成功','游戏充值'],
 ['BX002','帝国雄师','893','100.20','2026-09-02','成功','游戏充值'],
 ['BX003','竹币平台','0','20.06','2026-09-03','已支付','竹币充值'],
 ['BX004','帝国雄师','893','200.00','2026-09-03','待支付','游戏充值'],
 ['BX002','帝国雄师','893','100.20','2026-09-02','成功','游戏充值']
]

describe('大熊游戏订单导入只读核对',()=>{
  it('自动识别订单列与金额，保留分精度',()=>{
    const map=suggestFieldMapping(headers)
    expect(map).toMatchObject({orderId:'0',gameName:'1',gameId:'2',paidAmount:'3',paidAt:'4',status:'5',orderType:'6'})
    expect(getMissingMapping(map)).toEqual([])
    expect(readAmountCents('￥1,234.56')).toBe(123456)
    expect(readAmountCents('0.01')).toBe(1)
    expect(readAmountCents('-4.50')).toBe(-450)
    expect(readAmountCents('120.345')).toBe(null)
    expect(readAmountCents('1234abc')).toBe(null)
  })

  it('自动检测前导标题行，支持Excel日期',()=>{
    const matrix=[['平台月报2026年9月'],[],headers,rows[1]]
    expect(detectOrderHeader(matrix)).toBe(2)
    expect(normalizePaidDate('20260930 22:03')).toBe('2026-09-30')
    expect(normalizePaidDate('2026/09/30')).toBe('2026-09-30')
    expect(normalizePaidDate('2026年9月30日')).toBe('2026-09-30')
    expect(normalizePaidDate('2026-02-30')).toBe(null)
    expect(normalizePaidDate('46192')).toMatch(/^2026-/)
  })

  it('重复单只算一次，待支付排除，竹币现金与游戏充值分离',()=>{
    const result=inspectOrderRows(rows)
    expect(result.missing).toEqual([])
    expect(result.summary).toMatchObject({rows:5,validGames:2,validCoins:1,duplicates:1,excluded:1,gameCents:110100,coinCents:2006})
    expect(result.months).toEqual(['2026-09'])
    const report=reportFromInspectedRows(result,'2026-09')
    expect(report).toMatchObject({source:'file-preview',cash:1101,coinCash:20.06,orders:2})
    expect(report.games).toMatchObject([{id:'893',name:'帝国雄师',cash:1101,orders:2}])
  })

  it('相同订单号金额不一致必须全部标记冲突，不得保留第一次金额',()=>{
    const mismatch=inspectOrderRows([headers,
      ['A1','雷鸣三国','124','200.00','2026-09-01','成功','游戏充值'],
      ['A1','雷鸣三国','124','250.00','2026-09-01','成功','游戏充值'],
      ['A2','雷鸣三国','124','100.00','2026-09-02','成功','游戏充值']
    ])
    expect(mismatch.summary.conflicts).toBe(2)
    expect(mismatch.summary.gameCents).toBe(10000)
    expect(mismatch.records.filter(r=>r.disposition==='conflict')).toHaveLength(2)
    expect(mismatch.assumptions.join(' ')).toContain('冲突')
  })

  it('失败退款与未知状态不得计入有效收入',()=>{
    const report=inspectOrderRows([headers,
      ['R1','帝国雄师','893','300','2026-09-01','退款成功','游戏充值'],
      ['R2','帝国雄师','893','300','2026-09-01','取消','游戏充值'],
      ['R3','帝国雄师','893','300','2026-09-01','等待对账','游戏充值'],
      ['R4','帝国雄师','893','-1','2026-09-01','成功','游戏充值'],
      ['R5','帝国雄师','893','10.00','2026-09-01','成功','未知资产']
    ])
    expect(report.summary).toMatchObject({validGames:0,review:2,excluded:3,gameCents:0})
  })

  it('没有日期与订单号映射时禁止试算',()=>{
    const report=inspectOrderRows([
      ['游戏名称','金额'],
      ['帝国雄师','100']
    ])
    expect(report.missing).toContain('orderId')
    expect(report.missing).toContain('paidAt')
    expect(report.records).toHaveLength(0)
    const reused=inspectOrderRows(rows,{mapping:{orderId:'0',paidAmount:'0',paidAt:'4',gameName:'1',gameId:'2',status:'5',orderType:'6'}})
    expect(reused.missing).toContain('duplicateColumn')
  })

  it('没有支付状态和订单类型列时清晰提示试算假设',()=>{
    const importRows=[
      ['订单号','游戏名','金额','订单时间'],
      ['R1','雷鸣三国','1.01','2026-08-01']
    ]
    const report=inspectOrderRows(importRows)
    expect(report.summary.validGames).toBe(1)
    expect(report.assumptions).toHaveLength(2)
    expect(report.assumptions.join(' ')).toContain('未提供支付状态列')
    expect(report.assumptions.join(' ')).toContain('未提供业务类型列')
  })

  it('不同账期独立归属，金额以分累加没有浮点误差',()=>{
    const report=inspectOrderRows([headers,
      ['A1','雷鸣三国','124','0.01','2026-09-29','成功','游戏充值'],
      ['A2','雷鸣三国','124','0.02','2026-09-30','成功','游戏充值'],
      ['A3','雷鸣三国','124','1.00','2026-10-01','成功','游戏充值']
    ])
    expect(report.months).toEqual(['2026-10','2026-09'])
    expect(reportFromInspectedRows(report,'2026-09').cash).toBe(0.03)
    expect(reportFromInspectedRows(report,'2026-10').cash).toBe(1)
  })
  it('原始CSV保留18位订单号和前导零，正确处理引号和单元格换行',()=>{
    const matrix=parseDelimitedText('订单号,游戏名称,金额,订单时间\n"000123456789012345","帝国,雄师",12.03,2026-09-01\n"ABC\n123","雷鸣""三国",1.01,2026-09-02\n')
    expect(matrix[1]).toEqual(['000123456789012345','帝国,雄师','12.03','2026-09-01'])
    expect(matrix[2]).toEqual(['ABC\n123','雷鸣"三国','1.01','2026-09-02'])
    expect(parseDelimitedText('A\tB\n001\t1', '\t')[1][0]).toBe('001')
    expect(()=>parseDelimitedText('a,b\n"unclosed,xx')).toThrow('引号')
  })

  it('有面额和实付两列时优先选择实付，不按列出现顺序误选充值面额',()=>{
    const mapping=suggestFieldMapping(['订单号','充值金额','游戏名','订单时间','实际支付金额'])
    expect(mapping.paidAmount).toBe('4')
    expect(mapping.gameName).toBe('2')
  })

  it('疑似Excel科学计数法订单号直接排除，不允许与真实订单混淆',()=>{
    const result=inspectOrderRows([headers,
      ['1.23456E+17','帝国雄师','893','90.00','2026-09-05','成功','游戏充值']
    ])
    expect(result.summary.invalid).toBe(1)
    expect(result.summary.gameCents).toBe(0)
    expect(result.issues[0].reason).toContain('科学计数法')
  })

})
