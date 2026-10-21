import { describe, expect, it } from 'vitest'
import { contractAccessMatchesLine, splitContractGamePlatform } from './channelContractInlineReview.js'

describe('source discount names with an unambiguous terminal device', () => {
  it.each(['iOS', 'IOS', 'Android', 'android'])('recognizes numeric discount + %s without rewriting the source', device => {
    const source = '测试游戏折扣服0.05折' + device
    expect(splitContractGamePlatform(source)).toEqual({ name: '测试游戏折扣服0.05折', platform: device.toLowerCase() })
    expect(contractAccessMatchesLine(source, { product_name: '测试游戏折扣服（0.05折）', platform: device })).toBe(true)
    expect(contractAccessMatchesLine(source, { product_name: source, platform: device })).toBe(true)
    expect(source).toBe('测试游戏折扣服0.05折' + device)
  })
  it.each(['测试游戏ios', '测试游戏0.05折ios红包版', '测试游戏0.05折普通版ios', '测试游戏折ios'])('does not erase ambiguous title text: %s', source => {
    expect(splitContractGamePlatform(source)).toEqual({ name: source, platform: '' })
  })
  it('still rejects cross-platform evidence, missing coverage and different editions', () => {
    const source = '测试游戏折扣服0.05折iOS'
    for (const item of [
      { product_name: '测试游戏折扣服0.05折', platform: 'Android' },
      { product_name: source, platform: 'Android' },
      { product_name: '测试游戏折扣服0.05折Android', platform: '全版本' },
      { product_name: '测试游戏折扣服0.05折', platform: '' },
      { product_name: '测试游戏折扣服0.1折', platform: 'iOS' },
      { product_name: '测试游戏折扣服0.05折红包版', platform: 'iOS' }
    ]) expect(contractAccessMatchesLine(source, item)).toBe(false)
  })
  it('never drops the marketing edition when discounts match', () => {
    expect(contractAccessMatchesLine('测试游戏3折', { product_name: '测试游戏（3折三国争霸）', platform: '全版本' })).toBe(false)
    expect(contractAccessMatchesLine('测试游戏（3折三国争霸）', { product_name: '测试游戏3折', platform: '全版本' })).toBe(false)
  })
})
