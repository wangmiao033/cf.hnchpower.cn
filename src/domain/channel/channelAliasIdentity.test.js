import { describe, expect, it } from 'vitest'
import { unifyLegacyChannelNamesForSamePartner } from './channelAliasIdentity.js'
import { auditChannelBillMonths } from './channelMonthCoverage.js'

const youhai = '西安游海网络科技有限公司'
const maiyou = '西安麦游网络科技有限公司'
const row = (id, channelName, partnerName, settlementMonth) =>
  ({ id, channelName, partnerName, settlementMonth, status: 'confirmed' })

describe('legacy channel names linked by legal customer identity', () => {
  it('unifies old and new labels for the same legal company without rewriting source', () => {
    const original = [
      row('1', '游海（麦游）', youhai, '2026-05'),
      row('2', '游海', youhai, '2026-06')
    ]
    const result = unifyLegacyChannelNamesForSamePartner(original)
    expect(result.map(item => item.channelName)).toEqual(['游海', '游海'])
    expect(result[0].originalChannelName).toBe('游海（麦游）')
    expect(original[0].channelName).toBe('游海（麦游）')
    expect(result[0].partnerName).toBe(youhai)
  })

  it('never merges different legal companies based on a similar channel name', () => {
    const original = [
      row('1', '游海（麦游）', maiyou, '2026-05'),
      row('2', '游海', youhai, '2026-06')
    ]
    const result = unifyLegacyChannelNamesForSamePartner(original)
    expect(result).toEqual(original)
    expect(auditChannelBillMonths(original, {
      endingMonth: '2026-09', windowSize: 6, now: new Date('2026-10-13')
    }).channels).toHaveLength(2)
  })

  it('does not merge when either bill lacks a reliable legal partner name', () => {
    const original = [
      row('1', '游海（麦游）', '', '2026-05'),
      row('2', '游海', '', '2026-06')
    ]
    expect(unifyLegacyChannelNamesForSamePartner(original)).toEqual(original)
  })

  it('counts a continuous April–September history as one channel when the company matches', () => {
    const months = ['04', '05', '06', '07', '08', '09']
    const records = months.map((month, index) =>
      row(String(index), index < 2 ? '游海（麦游）' : '游海', youhai, '2026-' + month)
    )
    const audit = auditChannelBillMonths(records, {
      endingMonth: '2026-09', windowSize: 6, now: new Date('2026-10-13')
    })
    expect(audit.coveredChannelCount).toBe(1)
    expect(audit.channels[0].name).toBe('游海')
    expect(audit.channels[0].covered).toBe(6)
    expect(audit.channels[0].gaps).toEqual([])
    expect(audit.trailingChannelCount).toBe(0)
  })
})
