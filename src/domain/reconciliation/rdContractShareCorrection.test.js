import { describe, expect, it } from 'vitest'
import { proposeRdContractShareCorrection, buildRdContractAccessShareUpdate } from './rdContractShareCorrection.js'

const contract = { id: 'c1', partner_id: 'p1' }
const match = { contract_id: 'c1', access_item_id: 'a1', product_name: '《六界飞仙》0.1折', our_share_rate: 20, authorization_status: 'covered' }
const accessItem = {
  id: 'a1', contract_id: 'c1', product_name: '《六界飞仙》0.1折',
  share_rate: '20', channel_fee_rate: '0', authorization_start: '2026-01-01',
  authorization_end: '2026-12-31', remarks: '原合作备注', platform: '安卓', status: '生效'
}
const line = { gameName: '《六界飞仙》0.1折', shareRatio: '20' }

describe('研发合作分成方向校正', () => {
  it('uses the developer bill rate to propose our company share', () => {
    expect(proposeRdContractShareCorrection(line, match)).toEqual({
      developerShare: 20, ourShare: 80, currentOurShare: 20
    })
    expect(proposeRdContractShareCorrection({ ...line, shareRatio: '80' }, match)).toBeNull()
    expect(proposeRdContractShareCorrection({ ...line, shareRatio: '' }, match)).toBeNull()
  })
  it('updates only matching access item metadata and preserves other fields', () => {
    const original = JSON.stringify(accessItem)
    const value = buildRdContractAccessShareUpdate({
      contract, accessItem, match, line, partnerId: 'p1', auditDate: '2026-10-08'
    })
    expect(value.payload.share_rate).toBe(80)
    expect(value.payload.channel_fee_rate).toBe('0')
    expect(value.payload.platform).toBe('安卓')
    expect(value.payload.authorization_end).toBe('2026-12-31')
    expect(value.payload.remarks).toContain('原合作备注')
    expect(value.payload.remarks).toContain('我方分成20%→80%')
    expect(value.payload.remarks).toContain('研发分成80%→20%')
    expect(JSON.stringify(accessItem)).toBe(original)
  })
  it('rejects changed, mismatched or unauthorized contract data', () => {
    const build = (overrides = {}) => buildRdContractAccessShareUpdate({
      contract, accessItem, match, line, partnerId: 'p1', auditDate: '2026-10-08', ...overrides
    })
    expect(() => build({ accessItem: { ...accessItem, share_rate: '30' } })).toThrow('已经变化')
    expect(() => build({ accessItem: { ...accessItem, id: 'other' } })).toThrow('关联已经变化')
    expect(() => build({ partnerId: 'another' })).toThrow('合同所属客户')
    expect(() => build({ match: { ...match, authorization_status: 'out_of_range' } })).toThrow('授权身份')
    expect(() => build({ accessItem: { ...accessItem, product_name: '《云上征途》0.05折' } })).toThrow('名称已变化')
  })
})
