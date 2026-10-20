import { describe, expect, it } from 'vitest'
import { inspectOrderRows } from './orderPreviewImport.js'
import { assertValidLocalPreview, makeLocalDraftPayload } from './deviceDraft.js'

function inspectedPreview() {
  const matrix = [
    ['订单号', '游戏名称', '游戏ID', '实付金额', '支付时间', '订单状态', '业务类型'],
    ['DX0001', '雷鸣三国', '124', '12.34', '2026-08-01', '支付成功', '游戏充值'],
    ['DX0002', '竹币充值', '0', '5.01', '2026-09-01', '已支付', '竹B充值'],
    ['DX0003', '雷鸣三国', '124', '30.00', '2026-09-02', '待支付', '游戏充值']
  ]
  return {
    ...inspectOrderRows(matrix),
    fileName: 'ledger.csv',
    draftId: 'test-import-001',
    sheetName: '订单明细',
    arbitrarySecretField: 'should-not-persist'
  }
}

describe('大熊游戏按账号本机保存订单草稿', () => {
  it('只保留必要标准字段，现金金额和竹B必须与明细一致', () => {
    const local = makeLocalDraftPayload(inspectedPreview())
    expect(local.records).toHaveLength(3)
    expect(local.summary.gameCents).toBe(1234)
    expect(local.summary.coinCents).toBe(501)
    expect(local.months).toEqual(['2026-09','2026-08'])
    expect(local.records[0].orderId).toBe('DX0001')
    expect(local.arbitrarySecretField).toBeUndefined()
    expect(assertValidLocalPreview(local)).toBe(true)
  })

  it('被修改的金额汇总、坏记录和不匹配账期必须拒绝恢复', () => {
    const altered = makeLocalDraftPayload(inspectedPreview())
    altered.summary.gameCents = 99999
    expect(() => assertValidLocalPreview(altered)).toThrow('订单汇总与明细金额不一致')
    altered.summary.gameCents = 1234
    altered.records[0].amountCents = 12.34
    expect(() => assertValidLocalPreview(altered)).toThrow('整数分')
    altered.records[0].amountCents = 1234
    altered.months = ['2026-09']
    expect(() => assertValidLocalPreview(altered)).toThrow('账期')
  })

  it('没有导入ID、无月份、不安全订单金额均不允许写入', () => {
    const bad = inspectedPreview()
    bad.draftId = ''
    expect(() => makeLocalDraftPayload(bad)).toThrow('草稿标识')
    bad.draftId = 'good'
    bad.months = []
    expect(() => makeLocalDraftPayload(bad)).toThrow('结算月份')
    bad.months = ['2026-09','2026-08']
    bad.records[0].amountCents = 0
    expect(() => makeLocalDraftPayload(bad)).toThrow('大于零')
  })

  it('不触碰原导入对象', () => {
    const source = inspectedPreview()
    const saved = makeLocalDraftPayload(source)
    saved.records[0].gameName = 'not original'
    saved.months[0] = '2026-01'
    expect(source.records[0].gameName).toBe('雷鸣三国')
    expect(source.months).toEqual(['2026-09','2026-08'])
  })
})
