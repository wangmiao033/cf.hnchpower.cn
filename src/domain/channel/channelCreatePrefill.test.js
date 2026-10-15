import { describe, expect, it } from 'vitest'
import { resolveChannelCreatePrefill } from './channelCreatePrefill.js'
import { billDraftKey } from '@/domain/drafts/billDrafts.js'

const partners = [
  { id:'vivo-1', name:'维沃移动通信有限公司', shortName:'vivo天鑫' },
  { id:'opp-1', name:'广东欧珀移动通信有限公司', shortName:'OPPO渠道' }
]
const vivoRows = [
  { channelName:'vivo天鑫', partnerName:'维沃移动通信有限公司', gameName:'仙帝神兵', settlementMonth:'2026-08' },
  { channelName:'vivo天鑫', partnerName:'维沃移动通信有限公司', gameName:'云上征途', settlementMonth:'2026-09' },
  { channelName:'vivo天鑫', partnerName:'维沃移动通信有限公司', gameName:'帝国雄师', settlementMonth:'2026-07' }
]

describe('渠道列表搜索 → 按渠道新建账单', () => {
  it('搜索vivo命中同一渠道多张账单，返回唯一正式公司和渠道名', () => {
    expect(resolveChannelCreatePrefill({ records:vivoRows, partners, search:'vivo' })).toEqual({
      partnerId:'vivo-1', partnerName:'维沃移动通信有限公司', channelName:'vivo天鑫'
    })
  })
  it('选择明确渠道，使用原渠道名而不是随机选择旧游戏/账期', () => {
    const result = resolveChannelCreatePrefill({records:vivoRows,partners,channelName:'vivo天鑫'})
    expect(result).toEqual({partnerId:'vivo-1',partnerName:'维沃移动通信有限公司',channelName:'vivo天鑫'})
    expect(Object.keys(result)).toEqual(['partnerId','partnerName','channelName'])
  })
  it('仅按游戏词命中的渠道记录，不得自动选公司', () => {
    expect(resolveChannelCreatePrefill({records:vivoRows,partners,search:'帝国雄师'})).toBeNull()
  })
  it('搜索结果涉及两个不同渠道时返回空，不乱填错误客户', () => {
    const mixed=[...vivoRows,{channelName:'vivo-渠道2',partnerName:'广东欧珀移动通信有限公司'}]
    expect(resolveChannelCreatePrefill({records:mixed,partners,search:'vivo'})).toBeNull()
  })
  it('只有同样渠道名、不同法定客户也不能猜测', () => {
    const mixed=[...vivoRows,{channelName:'vivo天鑫',partnerName:'广东欧珀移动通信有限公司'}]
    expect(resolveChannelCreatePrefill({records:mixed,partners,channelName:'vivo天鑫'})).toBeNull()
  })
  it('公司未关联客户库、歧义名称或无搜索条件都不得自动填写', () => {
    expect(resolveChannelCreatePrefill({records:vivoRows,partners:[],search:'vivo'})).toBeNull()
    expect(resolveChannelCreatePrefill({records:vivoRows,partners})).toBeNull()
    expect(resolveChannelCreatePrefill({records:[{channelName:'其他',partnerName:'未建客户'}],partners,channelName:'其他'})).toBeNull()
  })
  it('同名渠道中的客户简称可识别为唯一正式公司', () => {
    const rows=[{ channelName:'vivo天鑫',partnerName:'vivo天鑫' }]
    expect(resolveChannelCreatePrefill({records:rows,partners,search:'vivo'}).partnerName)
      .toBe('维沃移动通信有限公司')
  })
  it('按客户隔离本机新建草稿，但旧通用草稿路径保持不变', () => {
    expect(billDraftKey('channel','add')).toBe('caiwu:bill-draft:v1:channel:create')
    const scoped=billDraftKey('channel','add','','partner:vivo-1')
    expect(scoped).not.toBe(billDraftKey('channel','add'))
    expect(scoped).not.toBe(billDraftKey('channel','add','','partner:opp-1'))
    expect(billDraftKey('channel','edit','R1','','')).toBe('caiwu:bill-draft:v1:channel:edit:R1')
  })
})
