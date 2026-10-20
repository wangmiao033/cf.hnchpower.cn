import { describe, expect, it } from 'vitest'
import { CONTRACT_ACCESS_FIELDS, fullContractAccessUpdate, cleanContractDate,
  checkContractAuthorizationForMonth, accessDataModified, withContractReviewNote,
  comparableCommercialGameName, sameCommercialGameName, contractAccessMatchesLine, isSameCustomerRestoration } from './channelContractInlineReview.js'

const old = {
  id: 'item-A', contract_id: 'contract-A',
  channel_name: '湖南芯动', agreement_type: '渠道合作', platform_record_id: 'abc',
  product_name: '龙吟大陆', app_id: 'com.a', platform: 'Android', language: 'zh',
  category: '游戏', rights_source: '代理', game_status: '在营',
  agreement_status: '正常', authorization_start: null, authorization_end: null,
  share_rate: '30.00', channel_fee_rate: '0.00',
  software_copyright_no: '软著号', isbn: '批准文号', territory: '中国',
  status: '生效', remarks: '原合同说明'
}

describe('当前账单页安全核对候选合同', () => {
  it('全字段 PUT 保留所有既有合同资料，尤其是不触碰分成、费率及状态', () => {
    const revised = fullContractAccessUpdate(old, {
      product_name: '龙吟大陆（内置0.1折正版放置手游）',
      authorization_start: '2025-06-01',
      authorization_end: '2025-12-31',
    })
    expect(Object.keys(revised).sort()).toEqual([...CONTRACT_ACCESS_FIELDS].sort())
    expect(revised.channel_fee_rate).toBe('0.00')
    expect(revised.share_rate).toBe('30.00')
    expect(revised.isbn).toBe('批准文号')
    expect(revised.status).toBe('生效')
    expect(revised.remarks).toBe('原合同说明')
    expect(revised.authorization_start).toBe('2025-06-01')
  })
  it('缺失合作项资料禁止覆盖，避免PUT把授权/资质字段清空', () => {
    expect(() => fullContractAccessUpdate({...old, app_id: undefined, id:''})).toThrow()
    const { app_id, ...missing } = old
    expect(() => fullContractAccessUpdate(missing, {share_rate: 30})).toThrow('资料不完整')
    expect(() => fullContractAccessUpdate(old, {unknown:1})).toThrow('未知合同字段')
  })
  it('授权期必须是真实合法日期，明确落在账期之外时禁止保存', () => {
    expect(() => cleanContractDate('2025-02-30')).toThrow()
    expect(() => checkContractAuthorizationForMonth('2025-07','2025-08-01',null)).toThrow('不包含当前账期')
    expect(() => checkContractAuthorizationForMonth('2025-07','2025-07-31','2025-07-01')).toThrow('不能晚于')
    expect(checkContractAuthorizationForMonth('2025-07','2025-07-01',null)).toEqual({authorization_start:'2025-07-01',authorization_end:null})
    expect(checkContractAuthorizationForMonth('2025-07','',null)).toEqual({authorization_start:null,authorization_end:null})
  })
  it('必须有真实数据变更和核对依据，才能写入主合同', () => {
    expect(accessDataModified(old, {...old})).toBe(false)
    expect(accessDataModified(old,{...old,authorization_start:'2025-07-01'})).toBe(true)
    expect(() => withContractReviewNote(old,'好','2025-07')).toThrow('至少6个字')
    expect(withContractReviewNote(old,'已核对签署合同原件','2025-07')).toContain('原合同说明\n【账单页合同核对·2025-07】已核对签署合同原件')
  })
  it('识别7723清单中已存在的折扣游戏，版本、红包/普通版仍严格区分', () => {
    expect(comparableCommercialGameName('一起来修仙（0.05折）')).toBe('一起来修仙0.05折')
    expect(comparableCommercialGameName('一起来修仙005折')).toBe('一起来修仙0.05折')
    expect(sameCommercialGameName('一起来修仙(0.05折)', '一起来修仙005折')).toBe(true)
    expect(sameCommercialGameName('圣树唤歌(0.1折红包版)', '圣树唤歌01折红包版')).toBe(true)
    expect(sameCommercialGameName('圣树唤歌(0.1折红包版)', '圣树唤歌(0.05折红包版)')).toBe(false)
    expect(sameCommercialGameName('圣树唤歌(0.1折红包版)', '圣树唤歌(0.1折普通版)')).toBe(false)
    expect(sameCommercialGameName('圣树唤歌(0.1折红包版)', '圣树唤歌')).toBe(false)
    expect(sameCommercialGameName('一起来修仙(0.05折)', '圣树唤歌(0.05折)')).toBe(false)
  })

})


describe('设备平台不是商业折扣版本', () => {
  const item = { product_name: '一起来修仙005折', platform: '全版本' }
  it('全版本清单覆盖同SKU的iOS与Android', () => {
    expect(contractAccessMatchesLine('一起来修仙005折-ios', item)).toBe(true)
    expect(contractAccessMatchesLine('一起来修仙005折-ios', { ...item, platform: 'Android/iOS' })).toBe(true)
    expect(contractAccessMatchesLine('一起来修仙005折-ios', { ...item, platform: 'iOS / Android' })).toBe(true)
    expect(contractAccessMatchesLine('一起来修仙（0.05折）-Android', item)).toBe(true)
    expect(contractAccessMatchesLine('一起来修仙005折', item)).toBe(true)
  })
  it('不同设备和商业版本仍拒绝', () => {
    expect(contractAccessMatchesLine('一起来修仙005折-ios', { ...item, platform: 'Android' })).toBe(false)
    expect(contractAccessMatchesLine('一起来修仙01折-ios', item)).toBe(false)
    expect(contractAccessMatchesLine('一起来修仙005折红包版-ios', item)).toBe(false)
    expect(contractAccessMatchesLine('一起来修仙005折', { ...item, platform: 'iOS' })).toBe(true)
    expect(contractAccessMatchesLine('一起来修仙005折-ios', { ...item, platform: '' })).toBe(false)
  })
  it('设备产品后缀不能被全版本字段扩张', () => {
    expect(contractAccessMatchesLine('一起来修仙005折-ios', { ...item, product_name: '一起来修仙005折-Android' })).toBe(false)
    expect(contractAccessMatchesLine('一起来修仙005折-ios', { ...item, product_name: '一起来修仙005折-ios' })).toBe(true)
  })
})

describe('exact customer hydration preserves evidence only for the same identity', () => {
  const same = { mode: 'edit', currentName: '客户A', nextName: '客户A', currentId: '', nextId: 'a', resolvedCurrentId: 'a', selected: {} }
  it('restores missing ID for one unique exact current customer', () => {
    expect(isSameCustomerRestoration(same)).toBe(true)
    expect(isSameCustomerRestoration({ ...same, currentId: 'a' })).toBe(true)
  })
  it.each([
    { currentId: 'b' }, { resolvedCurrentId: 'b' }, { resolvedCurrentId: '' },
    { nextName: '客户B' }, { currentName: '客户B', currentId: 'a' },
    { selected: null, nextId: '' }, { nextName: '' }, { mode: 'add' }
  ])('does not preserve evidence for changed, ambiguous or unlinked identity %j', changes => {
    expect(isSameCustomerRestoration({ ...same, ...changes })).toBe(false)
  })
})

describe('undeclared bill device preserves legacy matching', () => {
  it.each(['Android', 'iOS', '全版本'])('accepts one exact SKU without inventing device: %s', platform => {
    expect(contractAccessMatchesLine('一起来修仙（0.05折）', { product_name: '一起来修仙（0.05折）', platform })).toBe(true)
  })
  it('allows unknown against a suffix but rejects contradictory candidate evidence', () => {
    expect(contractAccessMatchesLine('游戏005折', { product_name: '游戏005折-Android', platform: 'Android' })).toBe(true)
    expect(contractAccessMatchesLine('游戏005折', { product_name: '游戏005折-Android', platform: 'iOS' })).toBe(false)
  })
})
