import { describe, expect, it } from 'vitest'
import { isXiaomiPlatform, xiaomiThousandYuanPreset } from './xiaomiCumulativePreset.js'

describe('Xiaomi cumulative threshold setup (not an automatic mutation)', () => {
  it('uses the explicitly chosen channel name; does not assume every partner is Xiaomi', () => {
    expect(isXiaomiPlatform('小米', '北京游戏平台公司')).toBe(true)
    expect(isXiaomiPlatform('Xiaomi Developer', '')).toBe(true)
    expect(isXiaomiPlatform('OPPO', '北京游戏平台公司')).toBe(false)
  })
  it('prefills ¥1000 on confirmed platform settlement amount, never revenue', () => {
    const original = { settlement_mode: 'periodic', threshold_basis: 'billing_flow', threshold_amount: '' }
    const next = xiaomiThousandYuanPreset(original)
    expect(next).toMatchObject({
      enabled: true,
      settlement_mode: 'threshold',
      threshold_basis: 'settlement_amount',
      threshold_amount: '1000'
    })
    expect(original.settlement_mode).toBe('periodic')
  })
})
