import { describe, expect, it } from 'vitest'
import { inspectOrderRows } from '@/domain/selfOperated/orderPreviewImport.js'
import { prepareDaxiongServerImport, daxiongServerSummaryToReport } from './selfOperatedOrders.js'

const sourceData = [
  ['订单号','游戏名称','游戏ID','实付金额','支付时间','支付状态','订单类型'],
  ['000001','帝国雄师','893','100.01','2026-08-10','支付成功','游戏充值'],
  ['000002','帝国雄师','893','0.02','2026-09-01','成功','游戏充值'],
  ['000003','竹币充值','0','20.04','2026-09-02','已支付','竹B充值'],
  ['000004','帝国雄师','893','500.00','2026-09-02','待支付','游戏充值'],
  ['000002','帝国雄师','893','0.02','2026-09-01','成功','游戏充值']
]
function preview(){
  return {
    ...inspectOrderRows(sourceData),
    fileName:'daxiong_test.csv',
    draftId:'550e8400-e29b-41d4-a716-446655440000'
  }
}

describe('大熊游戏正式入账请求，只发送已核实的现金订单',()=>{
  it('过滤退款、待支付和文件内重复，仅保留游戏/竹B已支付金额',()=>{
    const p=prepareDaxiongServerImport(preview())
    expect(p.requestKey).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(p.sourceStatusColumnPresent).toBe(true)
    expect(p.sourceTypeColumnPresent).toBe(true)
    expect(p.rows).toHaveLength(3)
    expect(p.rows.map(row=>row.orderId)).toEqual(['000001','000002','000003'])
    expect(p.rows.map(row=>row.kind)).toEqual(['game','game','coin'])
    expect(p.rows.reduce((n,row)=>n+row.amountCents,0)).toBe(12007)
  })

  it('旧本机草稿缺字段映射时必须明确核对两类源字段后才能入账',()=>{
    const p=preview()
    delete p.fields
    expect(()=>prepareDaxiongServerImport(p)).toThrow('支付状态')
    expect(()=>prepareDaxiongServerImport(p,{statusConfirmed:true})).toThrow('业务类型')
    expect(prepareDaxiongServerImport(p,{statusConfirmed:true,typeConfirmed:true}).rows).toHaveLength(3)
  })

  it('拒绝篡改的金额汇总、单号、金额和支付状态',()=>{
    const p=preview()
    p.summary.gameCents=999
    expect(()=>prepareDaxiongServerImport(p)).toThrow('金额')
    p.summary.gameCents=10003
    p.records.find(r=>r.disposition==='ready').amountCents=20.12
    expect(()=>prepareDaxiongServerImport(p)).toThrow('精确到分')
    p.records.find(r=>r.disposition==='ready').amountCents=10001
    p.records.find(r=>r.disposition==='ready').orderId=''
    expect(()=>prepareDaxiongServerImport(p)).toThrow('订单编号')
  })

  it('服务端返回的按月总额按分读取，不混入尚未确认的买量费',()=>{
    const report=daxiongServerSummaryToReport({
      schema_ready:true,settlement_month:'2026-09',
      game_orders:912,game_cents:2503570,
      coin_orders:22,coin_cents:139868,
      games:[{game_id:'920',game_name:'异界深渊',orders:100,amount_cents:1045760}]
    })
    expect(report).toMatchObject({
      label:'2026年9月',cash:25035.7,coinCash:1398.68,
      spent:null,topup:null,orders:912,source:'server-ledger'
    })
    expect(report.games[0].cash).toBe(10457.6)
    expect(daxiongServerSummaryToReport({schema_ready:false})).toBeNull()
  })
})
