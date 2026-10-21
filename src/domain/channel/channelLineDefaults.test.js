import { describe, expect, it } from 'vitest'
import {
  applyCommercialDiscountFromGameName,
  canonicalCommercialDiscountLabel,
  commercialDiscountFactorFromGameName
} from './channelLineDefaults.js'

describe('channelLineDefaults / commercial discount', () => {
  it.each([
    ['测试游戏005折混服', 0.005], ['测试游戏01折', 0.01],
    ['测试游戏0050折', 0.005], ['测试游戏0005折', 0.0005],
    ['测试游戏005折红包版', 0.005], ['测试游戏005折Android', 0.005],
    ['测试游戏0折', null], ['测试游戏00折', null],
    ['测试游戏05折', 0.05], ['测试游戏0.05折', 0.005],
    ['测试游戏0.1折', 0.01], ['测试游戏3折', 0.3],
    ['测试游戏0.005折', 0.0005], ['测试游戏0.01折', 0.001],
    ['测试游戏10折', 1], ['测试游戏005折iOS', 0.005],
    ['测试游戏００５折混服', 0.005], ['测试游戏005', null],
    ['测试游戏ios', null], ['测试游戏', null]
  ])('keeps source label %s consistent with the contract recommendation', (gameName, factor) => {
    expect(commercialDiscountFactorFromGameName(gameName)).toBe(factor)
    if (factor != null) {
      const row = { gameName, discountFactor: String(factor) }
      expect(applyCommercialDiscountFromGameName(row)).toEqual(row)
    }
  })
  it('parses decimal and compact 折 spellings', () => {
    expect(canonicalCommercialDiscountLabel('一起来修仙（0.05折）')).toBe('0.05折')
    expect(canonicalCommercialDiscountLabel('一起来修仙005折')).toBe('0.05折')
    expect(canonicalCommercialDiscountLabel('云上征途3折大混服')).toBe('3折')
    expect(commercialDiscountFactorFromGameName('一起来修仙（0.05折）')).toBe(0.005)
    expect(commercialDiscountFactorFromGameName('云上征途3折大混服')).toBe(0.3)
  })

  it('fills discountFactor when still at default 1', () => {
    const row = applyCommercialDiscountFromGameName({ gameName: '一起来修仙（0.05折）', discountFactor: '1' })
    expect(row.discountFactor).toBe('0.005')
  })

  it('does not overwrite an explicit non-default discount', () => {
    const row = applyCommercialDiscountFromGameName({ gameName: '一起来修仙3折', discountFactor: '0.5' })
    expect(row.discountFactor).toBe('0.5')
  })
})
