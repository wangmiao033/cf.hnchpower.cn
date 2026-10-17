import { describe, expect, it } from 'vitest'
import {
  applyCommercialDiscountFromGameName,
  canonicalCommercialDiscountLabel,
  commercialDiscountFactorFromGameName
} from './channelLineDefaults.js'

describe('channelLineDefaults / commercial discount', () => {
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
