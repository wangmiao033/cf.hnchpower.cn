import { describe, expect, it } from 'vitest'
import {
 buildChannelAuditGroupIndex, resolveAuditCustomer, auditIdentityForBill,
 billIsMemberOfAuditGroup, groupContainsKeyword
} from './channelAuditGroups.js'

const a='武汉曦晨互娱网络科技有限公司'
const b='武汉杨桃网络科技有限公司'
const partners=[
 {id:'a',name:a,shortName:'曦晨互娱',channelAuditGroup:'武汉瓜子渠道'},
 {id:'b',name:b,shortName:'武汉瓜子',channelAuditGroup:'武汉瓜子渠道'},
 {id:'c',name:'厦门其他网络科技有限公司',shortName:'其他公司',channelAuditGroup:''}
]
const record=(company,channel) => ({partnerName:company,channelName:channel,settlementMonth:'2026-07'})
describe('渠道巡检关联组身份隔离',()=>{
 const index=buildChannelAuditGroupIndex(partners)
 it('仅将明确分配到同一巡检组的不同法律主体关联，展示两个成员',()=>{
   const ida=auditIdentityForBill(record(a,'曦晨渠道'),index)
   const idb=auditIdentityForBill(record(b,'武汉瓜子'),index)
   expect(ida.key).toBe('group:武汉瓜子渠道')
   expect(idb.key).toBe(ida.key)
   expect(ida.memberCompanies).toEqual([a,b])
   expect(auditIdentityForBill(record('厦门其他网络科技有限公司','其他渠道'),index).key)
     .toBe('channel:其他渠道')
 })
 it('不根据部分重叠名称、游戏名称或自由标签错误归组',()=>{
   expect(resolveAuditCustomer(record('武汉网络科技有限公司','武汉瓜子'),index)).toBeNull()
   expect(auditIdentityForBill(record('武汉网络科技有限公司','武汉瓜子'),index).isGroup).toBe(false)
 })
 it('搜索任一组名或关联法定主体，可以找到完整关联组',()=>{
   const identity=auditIdentityForBill(record(a,'曦晨渠道'),index)
   expect(groupContainsKeyword(identity,'杨桃')).toBe(true)
   expect(groupContainsKeyword(identity,'武汉瓜子渠道')).toBe(true)
 })
 it('凭唯一客户ID亦可归组，其他集团/无关联公司仍独立',()=>{
   expect(billIsMemberOfAuditGroup({partnerId:'b',channelName:'奇怪历史简称'},partners,'group:武汉瓜子渠道')).toBe(true)
   expect(billIsMemberOfAuditGroup(record('厦门其他网络科技有限公司','武汉瓜子'),partners,'group:武汉瓜子渠道')).toBe(false)
 })
 it('取消关联后立即回到两条独立渠道口径',()=>{
   const cleared=partners.map(x=>({...x,channelAuditGroup:''}))
   const idx=buildChannelAuditGroupIndex(cleared)
   expect(auditIdentityForBill(record(a,'曦晨渠道'),idx).key).toBe('channel:曦晨渠道')
   expect(auditIdentityForBill(record(b,'武汉瓜子'),idx).key).toBe('channel:武汉瓜子')
 })
})
