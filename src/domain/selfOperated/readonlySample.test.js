import {describe,it,expect} from 'vitest'
import {previewFor,compactMoney,exactMoney} from './readonlySample.js'
describe('大熊游戏第一阶段只读口径',()=>{
 it('一万元以上用万显示，精确金额不变',()=>{
  expect(compactMoney(24880.46)).toBe('¥2.49万')
  expect(compactMoney(10000)).toBe('¥1.0万')
  expect(exactMoney(24880.46)).toBe('¥24,880.46')
 })
 it('广告充值不是消耗，不得重复扣利润',()=>{
  const m=previewFor('2026-09')
  expect(m.cash).toBe(24880.46)
  expect(m.topup).toBe(5000)
  expect(m.spent).toBe(2300)
 })
 it('各个月份返回独立副本，不共享变更',()=>{
  const m=previewFor('2026-08')
  expect(m.cash).toBe(16500.2)
  m.games[0].cash=0
  expect(previewFor('2026-08').games[0].cash).toBe(7400)
 })
})
